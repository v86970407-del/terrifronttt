/**
 * Minimal static file server for the production build in ./out (used on Railway / Docker).
 * No dependencies: `node server.js` after `npm run build-prod`.
 *
 * - Listens on $PORT (Railway sets this), default 8080, on all interfaces.
 * - GET /healthz for health checks.
 * - gzip for text assets (cached in memory), Range support for audio.
 * - Unknown paths return 404 (no SPA fallback: /api/* must never answer with index.html).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "out");
const PORT = parseInt(process.env.PORT || "8080", 10);

const TYPES = {
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
	".woff": "font/woff", ".woff2": "font/woff2", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wasm": "application/wasm"
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".map", ".txt", ".svg"]);
const gzipCache = new Map();

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
	console.error("out/index.html not found. Run `npm run build-prod` first.");
	process.exit(1);
}

function send(res, status, body, headers = {}) {
	res.writeHead(status, {"Content-Type": "text/plain; charset=utf-8", ...headers});
	res.end(body);
}

const server = http.createServer((req, res) => {
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

	if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed", {Allow: "GET, HEAD"});

	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
	} catch {
		return send(res, 400, "Bad Request");
	}
	if (pathname === "/healthz") return send(res, 200, "ok", {"Cache-Control": "no-store"});
	if (pathname.endsWith("/")) pathname += "index.html";

	const file = path.join(ROOT, pathname);
	if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden");

	fs.stat(file, (error, stat) => {
		if (error || !stat.isFile()) return send(res, 404, "Not Found");

		const ext = path.extname(file).toLowerCase();
		const isHtml = ext === ".html";
		const headers = {
			"Content-Type": TYPES[ext] || "application/octet-stream",
			"Last-Modified": stat.mtime.toUTCString(),
			"ETag": `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
			"Cache-Control": isHtml ? "no-cache" : /^[0-9a-f]{20}\./.test(path.basename(file)) ? "public, max-age=31536000, immutable" : "public, max-age=3600",
			"Accept-Ranges": "bytes"
		};
		if (req.headers["if-none-match"] === headers["ETag"]) return send(res, 304, "", headers);

		const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
		if (range && !COMPRESSIBLE.has(ext) && (range[1] || range[2])) {
			let start = range[1] ? parseInt(range[1], 10) : Math.max(0, stat.size - parseInt(range[2], 10));
			let end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), stat.size - 1) : stat.size - 1;
			if (start > end || start >= stat.size) return send(res, 416, "Range Not Satisfiable", {"Content-Range": `bytes */${stat.size}`});
			res.writeHead(206, {...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1});
			return req.method === "HEAD" ? res.end() : fs.createReadStream(file, {start, end}).pipe(res);
		}

		if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
			headers["Content-Encoding"] = "gzip";
			headers["Vary"] = "Accept-Encoding";
			const key = `${file}:${stat.mtimeMs}`;
			let zipped = gzipCache.get(key);
			if (!zipped) {
				zipped = zlib.gzipSync(fs.readFileSync(file), {level: 9});
				gzipCache.set(key, zipped);
			}
			res.writeHead(200, {...headers, "Content-Length": zipped.length});
			return res.end(req.method === "HEAD" ? undefined : zipped);
		}

		res.writeHead(200, {...headers, "Content-Length": stat.size});
		if (req.method === "HEAD") return res.end();
		fs.createReadStream(file).pipe(res);
	});
});

server.listen(PORT, "0.0.0.0", () => console.log(`TerriFront client serving ./out on port ${PORT}`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
