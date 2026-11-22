import {PROTOCOL_VERSION} from "./protocol/PacketRegistry";
import {isBlockedAsInsecure} from "./ServerAddress";

/**
 * Asks a server how it is doing (GET /status, answered by every Vanilla Server) so the server browser can show its
 * name, players and ping.
 *
 * Everything a server sends is untrusted: it is validated, length-limited and only ever shown as plain text.
 */

const MAX_STATUS_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 6000;

export interface ServerInfo {
	motd: string;
	description: string;
	tags: string[];
	players: number;
	activeGames: number;
	protocolVersion: number;
	softwareVersion: string;
	requiresLogin: boolean;
	whitelist: boolean;
	shuttingDown: boolean;
	/** Self-declared (EULA): the server sells things for real money. */
	monetization: boolean;
	/** Self-declared (EULA): plugins change how the game plays. */
	modifiedGameplay: boolean;
	/** Hash of the server's logo, empty when it has none. */
	logoHash: string;
}

export type ServerFailure = "unreachable" | "timeout" | "insecure" | "invalid" | "too-large" | "http";

export type ServerQueryResult =
	| { state: "online", info: ServerInfo, latencyMs: number }
	| { state: "incompatible", info: ServerInfo, latencyMs: number, reason: "client-outdated" | "server-outdated" }
	| { state: "error", reason: ServerFailure };

/** Turns line breaks and tabs into spaces, removes other control and bidi-override characters, and clamps the length. */
export function cleanText(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	return value
		.replace(/\s+/g, " ")
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, "")
		.replace(/ {2,}/g, " ")
		.trim()
		.slice(0, max);
}

function cleanInt(value: unknown, max: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
}

/** Validates the JSON of a /status response. Returns null when it is not something a server would send. */
export function parseServerStatus(raw: unknown): ServerInfo | null {
	if (typeof raw !== "object" || raw === null) return null;
	const status = raw as Record<string, unknown>;
	if (typeof status["protocolVersion"] !== "number" || !Number.isInteger(status["protocolVersion"])) return null;

	const brand = typeof status["brand"] === "object" && status["brand"] !== null ? status["brand"] as Record<string, unknown> : {};
	const declarations = typeof status["declarations"] === "object" && status["declarations"] !== null ? status["declarations"] as Record<string, unknown> : {};
	const tags = Array.isArray(brand["tags"]) ? brand["tags"].map(tag => cleanText(tag, 16)).filter(tag => tag !== "").slice(0, 5) : [];
	const logoHash = cleanText(brand["logoSha256"], 64);

	return {
		motd: cleanText(brand["motd"], 120),
		description: cleanText(brand["description"], 300),
		tags,
		players: cleanInt(status["players"], 100000),
		activeGames: cleanInt(status["activeGames"], 100000),
		protocolVersion: status["protocolVersion"],
		softwareVersion: cleanText(status["version"], 16),
		requiresLogin: status["requiresLogin"] === true,
		whitelist: status["whitelist"] === true,
		shuttingDown: status["shuttingDown"] === true,
		monetization: declarations["monetization"] === true,
		modifiedGameplay: declarations["modifiedGameplay"] === true,
		logoHash: /^[0-9a-f]{64}$/.test(logoHash) ? logoHash : ""
	};
}

/** Reads a response body, giving up once it is larger than `max` bytes. */
async function readLimitedText(response: Response, max: number): Promise<string | null> {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > max) return null;
	if (!response.body) {
		const text = await response.text();
		return text.length > max ? null : text;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (; ;) {
		const {done, value} = await reader.read();
		if (done) break;
		total += value.length;
		if (total > max) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return new TextDecoder().decode(bytes);
}

export interface QueryEnvironment {
	fetch: typeof fetch;
	now: () => number;
	pageProtocol: string;
}

const defaultEnvironment = (): QueryEnvironment => ({
	fetch: (input, init) => fetch(input, init),
	now: () => performance.now(),
	pageProtocol: location.protocol
});

/**
 * Queries a server. Never throws, failures are returned as `{state: "error"}`.
 * @param address canonical server address (see normalizeServerAddress)
 * @param signal aborts the query (the result is then an "unreachable" error that callers should ignore)
 */
export async function queryServerStatus(address: string, signal?: AbortSignal, env: QueryEnvironment = defaultEnvironment()): Promise<ServerQueryResult> {
	if (isBlockedAsInsecure(address, env.pageProtocol)) return {state: "error", reason: "insecure"};

	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, REQUEST_TIMEOUT_MS);
	const forwardAbort = () => controller.abort();
	signal?.addEventListener("abort", forwardAbort, {once: true});
	if (signal?.aborted) controller.abort();

	const request = (path: string) => env.fetch(`${address}${path}`, {
		signal: controller.signal,
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
		redirect: "error"
	});

	try {
		const started = env.now();
		const response = await request("/status");
		let latencyMs = Math.max(1, Math.round(env.now() - started));
		if (!response.ok) return {state: "error", reason: "http"};
		const text = await readLimitedText(response, MAX_STATUS_BYTES);
		if (text === null) return {state: "error", reason: "too-large"};

		let info: ServerInfo | null;
		try {
			info = parseServerStatus(JSON.parse(text));
		} catch {
			info = null;
		}
		if (!info) return {state: "error", reason: "invalid"};

		// The first request also pays for DNS and the TLS handshake, a second tiny one shows the real round trip
		try {
			const second = env.now();
			const health = await request("/health");
			await health.arrayBuffer();
			latencyMs = Math.min(latencyMs, Math.max(1, Math.round(env.now() - second)));
		} catch {
			// keep the first measurement
		}

		if (info.protocolVersion !== PROTOCOL_VERSION) {
			return {state: "incompatible", info, latencyMs, reason: info.protocolVersion > PROTOCOL_VERSION ? "client-outdated" : "server-outdated"};
		}
		return {state: "online", info, latencyMs};
	} catch {
		return {state: "error", reason: timedOut ? "timeout" : "unreachable"};
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", forwardAbort);
	}
}
