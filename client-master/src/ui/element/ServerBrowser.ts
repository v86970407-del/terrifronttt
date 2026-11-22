import {getSettingObject} from "../../util/settings/UserSettingManager";
import {displayHost, isBlockedAsInsecure, normalizeServerAddress} from "../../network/ServerAddress";
import {queryServerStatus, type ServerFailure, type ServerInfo, type ServerQueryResult} from "../../network/ServerStatus";
import {MAX_SAVED_SERVERS, ServerList} from "../../util/ServerList";

/**
 * The server browser of the home menu: a list of saved servers with live status (name, players, ping), plus
 * "Direct Connect", "Add Server", "Edit" and "Delete". The markup lives in MainMenu.html, MainMenu.ts only opens and closes the view.
 *
 * Joining a server stores its address in the "game-server" setting (the same one the advanced settings show) and
 * then opens the normal lobby, so nothing else in the client needs to know about this list.
 */

export interface ServerBrowserHooks {
	/** Returns a message when the player cannot join right now (e.g. invalid player name), otherwise null. */
	joinBlocker(): string | null;
	/** Opens the lobby. Called after the "game-server" setting points at the chosen server. */
	join(): void;
	/** The player pressed Escape in the list. */
	requestClose(): void;
}

interface Entry {
	id: string;
	name: string;
	address: string;
}

type Health = { kind: "pending" } | { kind: "result", result: ServerQueryResult };
type Mode = "list" | "form" | "confirm";
type FormKind = "add" | "edit" | "direct";

const CONCURRENT_QUERIES = 4;

const serverList = new ServerList();

/** Name shown for a server address: the saved name if the player saved it, otherwise its host. */
export function getServerDisplayName(address: string): string {
	return serverList.findByAddress(address)?.name ?? displayHost(address);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function byId<T extends HTMLElement>(id: string): T {
	const node = document.getElementById(id);
	if (!node) throw new Error(`Server browser element #${id} is missing from MainMenu.html`);
	return node as T;
}

const INSECURE_MESSAGE = "Browsers only allow https servers on this page. Ask the owner for an https address.";

const FAILURE_TEXT: Record<ServerFailure, string> = {
	unreachable: "Can't connect to server.",
	timeout: "Server took too long to answer.",
	insecure: "Blocked: this page only allows https servers.",
	invalid: "That address is not a TerriFront server.",
	"too-large": "Server sent an invalid answer.",
	http: "Server answered with an error."
};

/** 0 = no signal ... 4 = excellent */
function pingLevel(latencyMs: number): number {
	if (latencyMs < 80) return 4;
	if (latencyMs < 160) return 3;
	if (latencyMs < 320) return 2;
	return 1;
}

export interface ServerBrowser {
	/** Call when the view becomes visible: selects the current server and refreshes every status. */
	open(): void;
	/** Call when the view is hidden: stops running status checks. */
	close(): void;
}

export function initServerBrowser(hooks: ServerBrowserHooks): ServerBrowser {
	const title = byId<HTMLElement>("serverViewTitle");
	const listSection = byId<HTMLElement>("serverListSection");
	const formSection = byId<HTMLElement>("serverFormSection");
	const confirmSection = byId<HTMLElement>("serverConfirmSection");
	const list = byId<HTMLElement>("serverList");
	const notice = byId<HTMLElement>("serverNotice");
	const btnJoin = byId<HTMLButtonElement>("btnServerJoin");
	const btnDirect = byId<HTMLButtonElement>("btnServerDirect");
	const btnAdd = byId<HTMLButtonElement>("btnServerAdd");
	const btnRefresh = byId<HTMLButtonElement>("btnServerRefresh");
	const btnEdit = byId<HTMLButtonElement>("btnServerEdit");
	const btnDelete = byId<HTMLButtonElement>("btnServerDelete");
	const nameLabel = byId<HTMLElement>("serverNameLabel");
	const nameInput = byId<HTMLInputElement>("serverNameInput");
	const addressInput = byId<HTMLInputElement>("serverAddressInput");
	const formHint = byId<HTMLElement>("serverFormHint");
	const formError = byId<HTMLElement>("serverFormError");
	const btnFormOk = byId<HTMLButtonElement>("btnServerFormOk");
	const btnFormCancel = byId<HTMLButtonElement>("btnServerFormCancel");
	const confirmText = byId<HTMLElement>("serverConfirmText");
	const btnConfirmYes = byId<HTMLButtonElement>("btnServerConfirmYes");
	const btnConfirmNo = byId<HTMLButtonElement>("btnServerConfirmNo");

	const health = new Map<string, Health>();
	const rows = new Map<string, HTMLElement>();
	let selectedId = "";
	let mode: Mode = "list";
	let formKind: FormKind = "add";
	let refreshRun = 0;
	let abort: AbortController | null = null;
	let refreshing = false;

	const entries = (): Entry[] => serverList.servers.map(server => ({id: server.id, name: server.name, address: server.address}));
	const selectedEntry = (): Entry | undefined => entries().find(entry => entry.id === selectedId);

	/* ---------------------------------------------------------------- rows */

	function buildRow(entry: Entry): HTMLElement {
		const row = element("div", "server-entry");
		row.id = `server-option-${entry.id}`;
		row.setAttribute("role", "option");
		row.dataset["id"] = entry.id;

		const icon = element("span", "server-icon");
		icon.setAttribute("aria-hidden", "true");

		const main = element("div", "server-main");
		const head = element("div", "server-head");
		head.append(element("span", "server-name", entry.name), element("span", "server-badges"));
		main.append(head, element("span", "server-sub"));

		const side = element("div", "server-side");
		const players = element("span", "server-players");
		players.append(element("span", "lobby-icon-player"), element("span", "server-players-count"));
		const ping = element("span", "server-ping");
		const bars = element("span", "server-bars");
		for (let i = 0; i < 4; i++) bars.appendChild(document.createElement("i"));
		ping.append(bars, element("span", "server-ping-ms"));
		side.append(players, ping);

		row.append(icon, main, side);
		row.addEventListener("click", () => select(entry.id));
		row.addEventListener("dblclick", () => {
			select(entry.id);
			join();
		});
		return row;
	}

	function infoOf(entry: Entry): ServerInfo | null {
		const state = health.get(entry.id);
		if (state?.kind === "result" && (state.result.state === "online" || state.result.state === "incompatible")) return state.result.info;
		return null;
	}

	function paintRow(entry: Entry): void {
		const row = rows.get(entry.id);
		if (!row) return;
		const state = health.get(entry.id) ?? {kind: "pending"} as Health;
		const name = row.querySelector<HTMLElement>(".server-name")!;
		const sub = row.querySelector<HTMLElement>(".server-sub")!;
		const badges = row.querySelector<HTMLElement>(".server-badges")!;
		const count = row.querySelector<HTMLElement>(".server-players-count")!;
		const players = row.querySelector<HTMLElement>(".server-players")!;
		const ping = row.querySelector<HTMLElement>(".server-ping")!;
		const ms = row.querySelector<HTMLElement>(".server-ping-ms")!;
		const icon = row.querySelector<HTMLElement>(".server-icon")!;

		name.textContent = entry.name;
		badges.replaceChildren();
		const addBadge = (text: string, tone: string, hint: string) => {
			const badge = element("span", `server-badge server-badge-${tone}`, text);
			badge.title = hint;
			badges.appendChild(badge);
		};

		let tone = "muted";
		let text = "";
		let pingState = "none";
		let level = 0;
		let pingText = "";
		let playersText = "";

		if (state.kind === "pending") {
			text = "Contacting server...";
			pingState = "pending";
		} else if (state.result.state === "error") {
			text = FAILURE_TEXT[state.result.reason];
			tone = "error";
			pingState = "error";
		} else {
			const {info, latencyMs} = state.result;
			level = pingLevel(latencyMs);
			pingState = "level";
			pingText = `${latencyMs} ms`;
			playersText = String(info.players);
			text = info.motd || info.description || "No description.";
			if (state.result.state === "incompatible") {
				tone = "error";
				text = state.result.reason === "client-outdated"
					? "Needs a newer game version. Reload the page to update."
					: "This server is out of date.";
			} else if (info.shuttingDown) {
				tone = "warn";
				text = "Server is restarting.";
			}
			if (info.requiresLogin) addBadge("LOGIN", "info", "You must be logged in to join");
			if (info.whitelist) addBadge("WHITELIST", "info", "Only invited players can join");
			if (info.modifiedGameplay) addBadge("MODDED", "warn", "The server changes how the game plays");
			if (info.monetization) addBadge("SHOP", "warn", "The server sells things for real money");
			const logo = icon.dataset["logo"] ?? "";
			if (info.logoHash !== logo) {
				icon.dataset["logo"] = info.logoHash;
				icon.replaceChildren();
				if (info.logoHash) {
					const image = new Image();
					image.alt = "";
					image.decoding = "async";
					image.referrerPolicy = "no-referrer";
					image.draggable = false;
					image.addEventListener("error", () => image.remove());
					image.src = `${entry.address}/logo?v=${info.logoHash.slice(0, 12)}`;
					icon.appendChild(image);
				}
			}
		}

		sub.textContent = text;
		sub.dataset["tone"] = tone;
		count.textContent = playersText;
		players.hidden = playersText === "";
		ping.dataset["state"] = pingState;
		ping.dataset["level"] = String(level);
		ms.textContent = pingText;
		ping.title = pingText;

		const infoNow = infoOf(entry);
		row.setAttribute("aria-label", `${entry.name}. ${text}${infoNow ? ` ${infoNow.players} players online.` : ""}`);
		row.setAttribute("aria-selected", String(entry.id === selectedId));
		row.dataset["tone"] = tone === "error" && pingState === "error" ? "down" : "up";
	}

	function renderList(): void {
		rows.clear();
		const all = entries();
		if (!all.some(entry => entry.id === selectedId)) selectedId = all[0]?.id ?? "";
		list.replaceChildren(...all.map(entry => {
			const row = buildRow(entry);
			rows.set(entry.id, row);
			return row;
		}));
		all.forEach(paintRow);
		if (all.length === 0) {
			list.appendChild(element("p", "server-empty", "No servers yet. Add one with Add Server, or type an address with Direct Connect."));
		}
		updateSelection();
	}

	function updateSelection(): void {
		for (const [id, row] of rows) row.setAttribute("aria-selected", String(id === selectedId));
		list.setAttribute("aria-activedescendant", `server-option-${selectedId}`);
		rows.get(selectedId)?.scrollIntoView({block: "nearest"});
		updateActions();
	}

	function select(id: string): void {
		selectedId = id;
		updateSelection();
	}

	/* ---------------------------------------------------------- actions state */

	function setNotice(message: string, tone: "info" | "error" = "info"): void {
		notice.textContent = message;
		notice.dataset["tone"] = tone;
	}

	function blockerMessage(): string | null {
		return hooks.joinBlocker();
	}

	function updateActions(): void {
		const entry = selectedEntry();
		const state = entry ? health.get(entry.id) : undefined;
		const incompatible = state?.kind === "result" && state.result.state === "incompatible";
		// Browsers refuse plain http connections from an https page, so joining would only end in "connection lost"
		const insecure = entry !== undefined && isBlockedAsInsecure(entry.address, location.protocol);
		btnJoin.disabled = !entry || incompatible || insecure;
		btnEdit.disabled = !entry;
		btnDelete.disabled = !entry;
		btnAdd.disabled = serverList.servers.length >= MAX_SAVED_SERVERS;
		btnRefresh.disabled = refreshing;

		const blocker = blockerMessage();
		if (blocker) setNotice(blocker, "error");
		else if (insecure) setNotice(INSECURE_MESSAGE, "error");
		else if (entry) setNotice("Community server: run by its owner. Only join servers you trust.", "info");
		else setNotice("", "info");
	}

	/* ------------------------------------------------------------- refreshing */

	async function queryOne(entry: Entry, signal: AbortSignal, run: number): Promise<void> {
		const result = await queryServerStatus(entry.address, signal);
		if (run !== refreshRun || signal.aborted) return;
		health.set(entry.id, {kind: "result", result});
		paintRow(entry);
		updateActions();
	}

	async function refresh(targets: Entry[] = entries()): Promise<void> {
		abort?.abort();
		const controller = new AbortController();
		abort = controller;
		const run = ++refreshRun;
		refreshing = true;
		for (const entry of targets) {
			health.set(entry.id, {kind: "pending"});
			paintRow(entry);
		}
		updateActions();

		const queue = [...targets];
		const worker = async () => {
			for (let entry = queue.shift(); entry; entry = queue.shift()) await queryOne(entry, controller.signal, run);
		};
		await Promise.all(Array.from({length: Math.min(CONCURRENT_QUERIES, queue.length)}, worker));
		if (run === refreshRun) {
			refreshing = false;
			updateActions();
		}
	}

	/* ---------------------------------------------------------------- joining */

	function connectTo(address: string): void {
		const blocker = blockerMessage();
		if (blocker) {
			setNotice(blocker, "error");
			return;
		}
		abort?.abort();
		getSettingObject("game-server").set(address).save();
		hooks.join();
	}

	function join(): void {
		const entry = selectedEntry();
		if (!entry || btnJoin.disabled) return;
		connectTo(entry.address);
	}

	/* ------------------------------------------------------- forms and confirm */

	function setMode(next: Mode): void {
		mode = next;
		listSection.hidden = next !== "list";
		formSection.hidden = next !== "form";
		confirmSection.hidden = next !== "confirm";
		if (next === "list") title.textContent = "Servers";
	}

	function showFormError(message: string, field: HTMLInputElement | null): void {
		formError.textContent = message;
		formError.hidden = message === "";
		nameInput.classList.remove("form-control-error");
		addressInput.classList.remove("form-control-error");
		field?.classList.add("form-control-error");
	}

	function openForm(kind: FormKind): void {
		formKind = kind;
		const entry = selectedEntry();
		setMode("form");
		showFormError("", null);
		const direct = kind === "direct";
		nameLabel.hidden = direct;
		nameInput.hidden = direct;
		title.textContent = kind === "add" ? "Add Server" : kind === "edit" ? "Edit Server" : "Direct Connect";
		btnFormOk.textContent = direct ? "Join Server" : "Done";
		formHint.textContent = direct
			? "Connect to any server without saving it."
			: "Example: play.example.com or localhost:10364";
		if (kind === "edit" && entry) {
			nameInput.value = entry.name;
			addressInput.value = entry.address;
		} else {
			nameInput.value = "";
			addressInput.value = direct ? serverList.lastDirect : "";
		}
		(direct || kind === "edit" ? addressInput : nameInput).focus();
		(direct ? addressInput : nameInput).select();
	}

	function closeForm(): void {
		setMode("list");
		updateSelection();
		list.focus();
	}

	function submitForm(): void {
		if (formKind === "direct") {
			const normalized = normalizeServerAddress(addressInput.value);
			if (!normalized.ok) return showFormError(normalized.error, addressInput);
			if (isBlockedAsInsecure(normalized.address, location.protocol)) return showFormError(INSECURE_MESSAGE, addressInput);
			if (blockerMessage()) return showFormError(blockerMessage()!, null);
			serverList.setLastDirect(addressInput.value.trim());
			connectTo(normalized.address);
			return;
		}

		const result = formKind === "edit" && selectedEntry()
			? serverList.update(selectedId, nameInput.value, addressInput.value)
			: serverList.add(nameInput.value, addressInput.value);
		if (!result.ok) return showFormError(result.error, result.field === "name" ? nameInput : result.field === "address" ? addressInput : null);
		selectedId = result.server.id;
		setMode("list");
		renderList();
		void refresh([{id: result.server.id, name: result.server.name, address: result.server.address}]);
		list.focus();
	}

	function askDelete(): void {
		const entry = selectedEntry();
		if (!entry) return;
		setMode("confirm");
		title.textContent = "Remove Server";
		confirmText.textContent = `Remove "${entry.name}" from your list?`;
		btnConfirmNo.focus();
	}

	function confirmDelete(): void {
		const entry = selectedEntry();
		if (entry) {
			const index = serverList.servers.findIndex(server => server.id === entry.id);
			serverList.remove(entry.id);
			health.delete(entry.id);
			const neighbour = serverList.servers[Math.min(index, serverList.servers.length - 1)];
			selectedId = neighbour?.id ?? "";
		}
		setMode("list");
		renderList();
		list.focus();
	}

	/* ----------------------------------------------------------------- wiring */

	btnJoin.addEventListener("click", join);
	btnDirect.addEventListener("click", () => openForm("direct"));
	btnAdd.addEventListener("click", () => openForm("add"));
	btnEdit.addEventListener("click", () => openForm("edit"));
	btnDelete.addEventListener("click", askDelete);
	btnRefresh.addEventListener("click", () => void refresh());
	btnFormOk.addEventListener("click", submitForm);
	btnFormCancel.addEventListener("click", closeForm);
	btnConfirmYes.addEventListener("click", confirmDelete);
	btnConfirmNo.addEventListener("click", closeForm);

	for (const input of [nameInput, addressInput]) {
		input.addEventListener("input", () => showFormError("", null));
		input.addEventListener("keydown", event => {
			if (event.key === "Enter") {
				event.preventDefault();
				submitForm();
			} else if (event.key === "Escape") {
				event.preventDefault();
				closeForm();
			}
		});
	}

	byId<HTMLElement>("serverConfirmSection").addEventListener("keydown", event => {
		if (event.key === "Escape") {
			event.preventDefault();
			closeForm();
		}
	});

	list.addEventListener("keydown", event => {
		const all = entries();
		const index = all.findIndex(entry => entry.id === selectedId);
		let next = index;
		switch (event.key) {
			case "ArrowDown": next = Math.min(all.length - 1, index + 1); break;
			case "ArrowUp": next = Math.max(0, index - 1); break;
			case "Home": next = 0; break;
			case "End": next = all.length - 1; break;
			case "Enter": event.preventDefault(); join(); return;
			case "Delete": askDelete(); return;
			case "Escape": hooks.requestClose(); return;
			default: return;
		}
		event.preventDefault();
		const target = all[next];
		if (target) select(target.id);
	});

	return {
		open() {
			setMode("list");
			const current = normalizeServerAddress(String(getSettingObject("game-server").get()));
			const match = current.ok ? entries().find(entry => entry.address === current.address) : undefined;
			selectedId = match?.id ?? selectedId;
			renderList();
			list.focus({preventScroll: true});
			void refresh();
		},
		close() {
			abort?.abort();
			refreshRun++;
			refreshing = false;
			setMode("list");
		}
	};
}
