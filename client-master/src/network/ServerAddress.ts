/**
 * Server addresses as typed by players in the server browser.
 *
 * The rest of the client stores and connects with an "origin" style address such as `https://play.example.com:10364`
 * (see the "game-server" setting and connectToServer). This module turns whatever a player typed into exactly that,
 * or explains what is wrong with it.
 */

export const MAX_ADDRESS_LENGTH = 200;

export type AddressResult = { ok: true, address: string } | { ok: false, error: string };

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** Machines on the player's own network, these are normally not reachable over https. */
const LOCAL_HOST = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[^.]+\.local)$/i;

/**
 * Turns player input into a canonical address (`http(s)://host[:port]`, lower case, no path).
 * Accepts `host`, `host:port`, and http/https/ws/wss URLs. Addresses without a scheme get https, except for machines on
 * the local network, which get http (a home server normally has no certificate).
 */
export function normalizeServerAddress(input: string): AddressResult {
	const text = input.trim();
	if (text === "") return {ok: false, error: "Enter a server address."};
	if (text.length > MAX_ADDRESS_LENGTH) return {ok: false, error: "That address is too long."};
	// eslint-disable-next-line no-control-regex
	if (/[\s\u0000-\u001f\u007f]/.test(text)) return {ok: false, error: "The address cannot contain spaces."};

	let candidate = text;
	if (!HAS_SCHEME.test(candidate)) {
		const host = candidate.split(/[/:?#]/)[0] ?? "";
		candidate = `${LOCAL_HOST.test(host) ? "http" : "https"}://${candidate}`;
	}

	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return {ok: false, error: "That is not a valid address."};
	}
	if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return {ok: false, error: "Use an http or https address."};
	if (url.username !== "" || url.password !== "") return {ok: false, error: "Remove the user name and password."};
	// Same rule as the "Server Address" setting: a real domain name / IPv4 address, or localhost
	if (url.hostname !== "localhost" && !url.hostname.includes(".")) return {ok: false, error: "Use a domain name like play.example.com."};
	if (url.hostname.endsWith(".") || url.hostname.startsWith(".")) return {ok: false, error: "That is not a valid address."};

	const secure = url.protocol === "https:" || url.protocol === "wss:";
	return {ok: true, address: `${secure ? "https" : "http"}://${url.host}`};
}

/** `host[:port]` without the scheme, for showing to players. */
export function displayHost(address: string): string {
	try {
		return new URL(address).host;
	} catch {
		return address;
	}
}

/** Browsers refuse plain http requests from https pages, except to the machine itself. */
export function isBlockedAsInsecure(address: string, pageProtocol: string): boolean {
	if (pageProtocol !== "https:") return false;
	try {
		const url = new URL(address);
		if (url.protocol !== "http:") return false;
		return !(url.hostname === "localhost" || /^127\./.test(url.hostname) || url.hostname === "[::1]");
	} catch {
		return false;
	}
}
