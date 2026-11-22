import {getSetting} from "../../util/settings/UserSettingManager";
import {connectToServer, disconnectFromServer, sendPacket, socketCloseRegistry} from "../../network/NetworkManager";
import {GameQueueUpdatePacket} from "../../network/protocol/packet/game/GameQueueUpdatePacket";
import {LobbyJoinPacket} from "../../network/protocol/packet/game/LobbyJoinPacket";
import {hidePanel, showPanel, updatePanel} from "../type/UIPanel";
import {buildButton, buildParagraph, buildTextNode, displayAlert} from "../type/TextNode";
import {buildContainer} from "../type/ContentField";
import {SocketErrorCodes} from "../../network/protocol/util/SocketErrorCodes";
import {awaitSafeForward} from "../../network/NetworkAuthenticator";
import {packetRegistry} from "../../network/PacketManager";
import europeMapPreview from "../../../resources/maps/Europe.png";
import worldMapPreview from "../../../resources/maps/World.png";
import whiteSeaMapPreview from "../../../resources/maps/attached-image-palette.png";

//@module ui

/** "browser" = the queue of lobbies, "joined" = the lobby the player picked. */
type LobbyView = "browser" | "joined";

const VIEW_TITLES: Record<LobbyView, string> = {
	browser: "Lobby Browser",
	joined: "Lobby"
};

/**
 * The server sends the queue as a burst of packets (position 0 first, then the queued games).
 * Rendering after every packet made the list collapse to one row and regrow. Instead the burst is
 * collected and shown once it has been quiet for this long.
 */
const BATCH_SETTLE_MS = 100;

const TIME_CLASSES = ["lobby-entry-time-soon", "lobby-entry-time-mid", "lobby-entry-time-late"];

let abortController: AbortController | null = null;
let lobbyPanelOpen = false;
let panelView: LobbyView = "browser";

// The lobby the player chose by clicking Join. The queue browser is always shown first; the joined
// view only appears once the player picks a game, whatever the server's `joined` flag says.
// selectedGame is the latest packet for that game (lobbyGames is replaced on every refresh).
let selectedGame: GameQueueUpdatePacket | null = null;
let selectionConfirmed = false;

let lobbyGames = new Map<number, GameQueueUpdatePacket>();
let pendingGames: Map<number, GameQueueUpdatePacket> | null = null;
let commitTimer: ReturnType<typeof setTimeout> | null = null;

// Describes what is currently drawn. When the next render has the same signature only the changing
// numbers (timer, player count) are patched in place, so the panel is not rebuilt every second.
let renderedSignature = "";

// Games the server reported as joined before the player clicked Join (see packet handler).
const unexpectedJoins = new Set<number>();

// Set while Leave lobby reconnects, so the expected socket close does not close the panel.
let ignoreNextClose = false;

function cancelPendingCommit(): void {
	if (commitTimer !== null) {
		clearTimeout(commitTimer);
		commitTimer = null;
	}
	pendingGames = null;
}

/** While the lobby is open the CSS hides the main menu so only the background image stays behind it. */
function setLobbyScene(active: boolean): void {
	document.documentElement.classList.toggle("lobby-active", active);
	document.dispatchEvent(new Event("lobby-scene-change"));
}

function resetLobbyState(): void {
	cancelPendingCommit();
	setLobbyScene(false);
	unexpectedJoins.clear();
	lobbyPanelOpen = false;
	panelView = "browser";
	selectedGame = null;
	selectionConfirmed = false;
	renderedSignature = "";
	lobbyGames = new Map();
}

/** Resets lobby state and shows the main menu again, without touching the connection. */
export function closeMultiplayerLobby(): void {
	resetLobbyState();
}

/** Closes the lobby and goes back to the home screen. */
function leaveLobby(): void {
	resetLobbyState();
	if (abortController) {
		abortController.abort();
		abortController = null;
	} else {
		disconnectFromServer();
	}
	hidePanel();
}

function connectLobby(): void {
	abortController = new AbortController();
	connectToServer(getSetting("game-server"), abortController.signal).then(() => {
		abortController = null;
	}).catch(() => {
		if (!lobbyPanelOpen) return;
		resetLobbyState();
		hidePanel();
		displayAlert("danger", "Could not connect to the game server");
	});
}

function buildConnecting() {
	return buildContainer("lobby-browser")
		.add(buildParagraph("Connecting to the game server...", "lobby-browser-empty"));
}

/**
 * Leave the joined lobby but stay in the lobby browser. There is no leave packet, so the connection is
 * reset: the server drops the player from the game and sends a fresh queue on the new connection.
 */
function returnToQueue(): void {
	if (!lobbyPanelOpen) return;
	cancelPendingCommit();
	selectedGame = null;
	selectionConfirmed = false;
	lobbyGames = new Map();
	renderedSignature = "";

	ignoreNextClose = true;
	setTimeout(() => {
		ignoreNextClose = false;
	}, 3000);
	abortController = null;
	disconnectFromServer();

	presentLobby("browser", buildConnecting());
	connectLobby();
}

/** Opens the panel with a new title when the view changes, otherwise just swaps the content. */
function presentLobby(view: LobbyView, content: ReturnType<typeof buildContainer>): void {
	if (view !== panelView) {
		panelView = view;
		showPanel(VIEW_TITLES[view], content).setCloseHandler(leaveLobby);
	} else {
		updatePanel(content);
	}
}

function selectGame(game: GameQueueUpdatePacket): void {
	selectedGame = game;
	selectionConfirmed = game.joined;
	if (!game.joined) {
		sendPacket(new LobbyJoinPacket(game.gameId));
	}
	renderLobby();
}

/* ---------- map artwork ---------- */

// Looks for /resources/maps/<Map name>.png once per map; maps without an image keep the placeholder.
const mapArt = new Map<string, string | null>();
const mapArtLoading = new Set<string>();
const bundledMapArt: Record<string, string> = {
	europe: europeMapPreview,
	world: worldMapPreview,
	"white sea": whiteSeaMapPreview
};

function mapArtCandidates(map: string): string[] {
	const name = map.trim();
	const capitalised = name.charAt(0).toUpperCase() + name.slice(1);
	return Array.from(new Set([name, capitalised])).map(n => `/resources/maps/${encodeURIComponent(n)}.png`);
}

function applyMapArt(key: string, url: string): void {
	document.querySelectorAll<HTMLElement>(".lobby-map-preview").forEach(element => {
		if (element.dataset["map"] === key) {
			element.style.backgroundImage = `url("${url}")`;
		}
	});
}

function loadMapArt(map: string): void {
	const key = map.toLowerCase();
	if (mapArt.has(key) || mapArtLoading.has(key)) return;
	mapArtLoading.add(key);
	const candidates = mapArtCandidates(map);
	const tryCandidate = (index: number): void => {
		if (index >= candidates.length) {
			mapArt.set(key, null);
			mapArtLoading.delete(key);
			return;
		}
		const image = new Image();
		image.onload = () => {
			mapArt.set(key, candidates[index]);
			mapArtLoading.delete(key);
			applyMapArt(key, candidates[index]);
		};
		image.onerror = () => tryCandidate(index + 1);
		image.src = candidates[index];
	};
	tryCandidate(0);
}

function buildMapPreview(map: string) {
	const key = map.toLowerCase();
	const preview = buildContainer("lobby-map-preview")
		.setAttribute("aria-hidden", "true")
		.setAttribute("data-map", key);
	const art = mapArt.get(key) ?? bundledMapArt[key];
	if (art) {
		preview.setAttribute("style", `background-image: url("${art}")`);
	} else if (art === undefined) {
		loadMapArt(map);
	}
	return preview;
}

/* ---------- building blocks ---------- */

/** Only FFA exists today. Team modes would return e.g. {label: "4 teams", className: "lobby-badge-teams-4"} here. */
function buildModeBadge(_game: GameQueueUpdatePacket) {
	return buildContainer("lobby-badge-ffa")
		.add(buildTextNode("FFA", "lobby-badge-ffa-text"));
}

function playerCountText(game: GameQueueUpdatePacket): string {
	return `${game.playerCount}/${game.maxPlayers}`;
}

function buildPlayerCount(game: GameQueueUpdatePacket) {
	return buildContainer("lobby-count")
		.add(buildTextNode(playerCountText(game), "lobby-count-text"));
}

/** Green when about to start, orange mid-queue, white otherwise. */
function timeClass(seconds: number): string {
	if (seconds <= 10) return "lobby-entry-time-soon";
	if (seconds <= 30) return "lobby-entry-time-mid";
	return "lobby-entry-time-late";
}

function isFull(game: GameQueueUpdatePacket): boolean {
	return game.playerCount >= game.maxPlayers && !game.joined;
}

function buildLobbyEntry(game: GameQueueUpdatePacket) {
	const details = buildContainer("lobby-entry-details")
		.add(buildTextNode(game.map, "lobby-entry-map"))
		.add(buildContainer("lobby-entry-meta")
			.add(buildModeBadge(game))
			.add(buildPlayerCount(game)));
	const status = buildContainer("lobby-entry-status")
		.add(buildTextNode(`${game.time}s`, timeClass(game.time)));
	const joinButton = buildButton(isFull(game) ? "Full" : "Join", "primary", "lobby-join-button");
	if (isFull(game)) {
		joinButton.getElement().setAttribute("disabled", "");
	} else {
		joinButton.onClick(() => selectGame(game));
	}

	return buildContainer("lobby-entry", game.position === 0 ? "lobby-entry-primary" : "lobby-entry-queued")
		.add(buildMapPreview(game.map))
		.add(details)
		.add(status)
		.add(joinButton);
}

/* ---------- in-place updates ---------- */

function setTime(target: Element | null, seconds: number): void {
	const element = target?.firstElementChild ?? target;
	if (!element) return;
	element.textContent = `${seconds}s`;
	element.classList.remove(...TIME_CLASSES);
	element.classList.add(timeClass(seconds));
}

function patchBrowser(games: GameQueueUpdatePacket[]): boolean {
	const rows = document.querySelectorAll<HTMLElement>(".lobby-list .lobby-entry");
	if (rows.length !== games.length) return false;
	games.forEach((game, index) => {
		const row = rows[index];
		const count = row.querySelector(".lobby-count-text");
		if (count) count.textContent = playerCountText(game);
		setTime(row.querySelector(".lobby-entry-status"), game.time);
	});
	return true;
}

function patchJoined(game: GameQueueUpdatePacket): boolean {
	const time = document.querySelector(".lobby-joined-time");
	const count = document.querySelector(".lobby-joined .lobby-count-text");
	if (!time || !count) return false;
	time.textContent = `${game.time}s`;
	count.textContent = playerCountText(game);
	return true;
}

/* ---------- rendering ---------- */

function renderLobbyBrowser(): void {
	const games = Array.from(lobbyGames.values()).sort((a, b) => a.position - b.position);
	const signature = "browser|" + games.map(g => `${g.gameId}:${g.position}:${g.map}:${g.joined}:${isFull(g)}`).join(",");
	if (panelView === "browser" && signature === renderedSignature && patchBrowser(games)) return;

	const list = buildContainer("lobby-list");
	if (games.length === 0) {
		list.add(buildParagraph("Finding available lobbies...", "lobby-browser-empty"));
	}
	for (const game of games) {
		list.add(buildLobbyEntry(game));
	}
	const footer = buildContainer("lobby-footer")
		.add(buildButton("\u2190 Go Back", "primary", "lobby-change-button").onClick(leaveLobby))
		.add(buildTextNode(getSetting("player-name"), "lobby-player-tag"));

	const previousScroll = document.querySelector<HTMLElement>(".lobby-list")?.scrollTop ?? 0;
	presentLobby("browser", buildContainer("lobby-browser").add(list).add(footer));
	renderedSignature = signature;
	const newList = document.querySelector<HTMLElement>(".lobby-list");
	if (newList) newList.scrollTop = previousScroll;
}

function renderJoinedLobby(game: GameQueueUpdatePacket): void {
	const signature = `joined|${game.gameId}:${game.map}`;
	if (panelView === "joined" && signature === renderedSignature && patchJoined(game)) return;

	const head = buildContainer("lobby-joined-head")
		.add(buildTextNode(game.map, "lobby-joined-map"))
		.add(buildModeBadge(game))
		.add(buildPlayerCount(game));
	const timer = buildContainer("lobby-joined-timer")
		.add(buildTextNode("Starts in", "lobby-joined-label"))
		.add(buildTextNode(`${game.time}s`, "lobby-joined-time"));
	const leaveButton = buildButton("Leave lobby", "danger", "lobby-leave-button").onClick(returnToQueue);

	presentLobby("joined", buildContainer("lobby-browser", "lobby-joined")
		.add(head)
		.add(timer)
		.add(leaveButton));
	renderedSignature = signature;
}

function renderLobby(): void {
	if (selectedGame) {
		renderJoinedLobby(selectedGame);
	} else {
		renderLobbyBrowser();
	}
}

/* ---------- entry point and packets ---------- */

export function openMultiplayerLobby(): void {
	if (lobbyPanelOpen) return;
	resetLobbyState();
	lobbyPanelOpen = true;
	setLobbyScene(true);

	showPanel(VIEW_TITLES.browser, buildConnecting()).setCloseHandler(leaveLobby);
	connectLobby();
}

function commitQueueUpdate(): void {
	commitTimer = null;
	if (!lobbyPanelOpen || !pendingGames) return;
	lobbyGames = pendingGames;
	pendingGames = null;
	renderLobby();
}

function updateSelection(packet: GameQueueUpdatePacket): void {
	if (selectedGame?.gameId !== packet.gameId) return;
	if (packet.joined) {
		selectionConfirmed = true;
		selectedGame = packet;
	} else if (selectionConfirmed) {
		// the server removed the player from the game: back to the queue browser
		selectedGame = null;
		selectionConfirmed = false;
	} else {
		// join not confirmed yet, keep showing the latest numbers
		selectedGame = packet;
	}
}

packetRegistry.handle(GameQueueUpdatePacket, function () {
	if (!lobbyPanelOpen) return;
	if (this.position === 0) {
		pendingGames = new Map(); // a new burst starts with the primary game
	} else if (!pendingGames) {
		pendingGames = new Map(lobbyGames);
	}
	pendingGames.set(this.gameId, this);
	updateSelection(this);
	if (this.joined && selectedGame?.gameId !== this.gameId && !unexpectedJoins.has(this.gameId)) {
		// This client only sends LobbyJoinPacket from selectGame(), so a joined game the player never
		// picked was joined by the server itself.
		unexpectedJoins.add(this.gameId);
		console.warn(`Server reports game ${this.gameId} as joined, but the player has not clicked Join.`);
	}

	if (commitTimer !== null) clearTimeout(commitTimer);
	commitTimer = setTimeout(commitQueueUpdate, BATCH_SETTLE_MS);
});

socketCloseRegistry.register(code => {
	if (ignoreNextClose) {
		ignoreNextClose = false;
		return;
	}
	if (lobbyPanelOpen) {
		resetLobbyState();
		abortController = null;
		hidePanel();
	}
	switch (code) {
		case SocketErrorCodes.NO_ERROR:
			break;
		case SocketErrorCodes.SERVER_OUT_OF_DATE:
			displayAlert("secondary", "This third party server is out of date, ask the server administrator to update it");
			break;
		case SocketErrorCodes.OUT_OF_DATE:
			displayAlert("secondary", "Server is for a newer version of the game, reloading the page...");
			setTimeout(() => {
				awaitSafeForward().then(() => window.location.reload()).catch(() => {});
			}, 5000);
			break;
		case SocketErrorCodes.NO_GAME_SERVER:
			displayAlert("secondary", "No game server is available, please try again later");
			break;
		default:
			displayAlert("danger", "Connection to server lost");
	}
});
