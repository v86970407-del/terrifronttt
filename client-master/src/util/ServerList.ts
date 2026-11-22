import {displayHost, normalizeServerAddress} from "../network/ServerAddress";

/**
 * The player's saved servers (the list in the server browser). Stored in the browser's local storage next to the settings.
 */
export interface SavedServer {
	id: string;
	name: string;
	/** Canonical address, see normalizeServerAddress */
	address: string;
}

export const MAX_SAVED_SERVERS = 50;
export const MAX_SERVER_NAME_LENGTH = 32;
const STORAGE_KEY = "wf@server-list";
const STORAGE_VERSION = 1;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
/** Which form field an error belongs to, so the UI can highlight it. */
export type ListErrorField = "name" | "address" | "list";
type ListResult = { ok: true, server: SavedServer } | { ok: false, error: string, field: ListErrorField };

/** Checks a server name. An empty name is fine (the host name is used instead). Returns an error message, or null. */
export function validateServerName(name: string): string | null {
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name)) return "The name contains invalid characters.";
	if (name.trim().length > MAX_SERVER_NAME_LENGTH) return `The name is too long (${MAX_SERVER_NAME_LENGTH} characters maximum).`;
	return null;
}

function newId(): string {
	const bytes = new Uint8Array(6);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function browserStorage(): StorageLike | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

export class ServerList {
	private entries: SavedServer[] = [];
	private direct = "";

	constructor(private readonly storage: StorageLike | null = browserStorage()) {
		this.load();
	}

	get servers(): readonly SavedServer[] {
		return this.entries;
	}

	/** The last address typed into "Direct Connect". */
	get lastDirect(): string {
		return this.direct;
	}

	setLastDirect(address: string): void {
		this.direct = address;
		this.save();
	}

	find(id: string): SavedServer | undefined {
		return this.entries.find(server => server.id === id);
	}

	findByAddress(address: string): SavedServer | undefined {
		return this.entries.find(server => server.address === address);
	}

	add(name: string, address: string): ListResult {
		if (this.entries.length >= MAX_SAVED_SERVERS) return {ok: false, error: `You can save up to ${MAX_SAVED_SERVERS} servers.`, field: "list"};
		const checked = this.check(name, address, undefined);
		if (!checked.ok) return checked;
		const server: SavedServer = {id: newId(), ...checked.value};
		this.entries.push(server);
		this.save();
		return {ok: true, server};
	}

	update(id: string, name: string, address: string): ListResult {
		const existing = this.find(id);
		if (!existing) return {ok: false, error: "That server no longer exists.", field: "list"};
		const checked = this.check(name, address, id);
		if (!checked.ok) return checked;
		existing.name = checked.value.name;
		existing.address = checked.value.address;
		this.save();
		return {ok: true, server: existing};
	}

	remove(id: string): boolean {
		const before = this.entries.length;
		this.entries = this.entries.filter(server => server.id !== id);
		if (this.entries.length === before) return false;
		this.save();
		return true;
	}

	private check(name: string, address: string, ignoreId: string | undefined): { ok: true, value: { name: string, address: string } } | { ok: false, error: string, field: ListErrorField } {
		const nameError = validateServerName(name);
		if (nameError) return {ok: false, error: nameError, field: "name"};
		const normalized = normalizeServerAddress(address);
		if (!normalized.ok) return {ok: false, error: normalized.error, field: "address"};
		const duplicate = this.findByAddress(normalized.address);
		if (duplicate && duplicate.id !== ignoreId) return {ok: false, error: `Already in your list as "${duplicate.name}".`, field: "address"};
		return {ok: true, value: {name: name.trim() === "" ? displayHost(normalized.address) : name.trim(), address: normalized.address}};
	}

	/** Loads the list, silently dropping anything that is not valid (the storage is not trusted either). */
	private load(): void {
		try {
			const raw = this.storage?.getItem(STORAGE_KEY);
			if (!raw) return;
			const data: unknown = JSON.parse(raw);
			if (typeof data !== "object" || data === null) return;
			const record = data as Record<string, unknown>;
			if (Array.isArray(record["servers"])) {
				for (const item of record["servers"]) {
					if (this.entries.length >= MAX_SAVED_SERVERS) break;
					if (typeof item !== "object" || item === null) continue;
					const {id, name, address} = item as Record<string, unknown>;
					if (typeof id !== "string" || !/^[0-9a-f]{12}$/.test(id) || typeof name !== "string" || typeof address !== "string") continue;
					const normalized = normalizeServerAddress(address);
					if (!normalized.ok || validateServerName(name) !== null) continue;
					if (this.entries.some(server => server.id === id || server.address === normalized.address)) continue;
					this.entries.push({id, name: name.trim() === "" ? displayHost(normalized.address) : name.trim(), address: normalized.address});
				}
			}
			if (typeof record["lastDirect"] === "string" && record["lastDirect"].length <= 200) this.direct = record["lastDirect"];
		} catch {
			// corrupt storage: start with an empty list
		}
	}

	private save(): void {
		try {
			this.storage?.setItem(STORAGE_KEY, JSON.stringify({v: STORAGE_VERSION, servers: this.entries, lastDirect: this.direct}));
		} catch (error) {
			console.warn("Could not save the server list.", error);
		}
	}
}
