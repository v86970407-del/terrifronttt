# TerriFront

Browser-based real-time strategy game (closed beta).

| Folder | What it is | Needed for beta? |
| --- | --- | --- |
| `client-master/` | The game (TypeScript + WebGL, built with webpack into a static site) | **Yes** |
| `server-master/` | Multiplayer game server (Bun) | No, multiplayer is dormant |
| `api-master/` | Account/map API (Bun + MySQL) | No |
| `protocol-master/`, `MapCodec-master/` | Shared libraries. Copies live inside the client and server `src/` folders | Reference only |

## Current beta state

- Singleplayer is playable.
- Multiplayer is **hidden**: the main menu has no "Play!" button. The lobby code is still in the project (`client-master/src/ui/element/MultiplayerLobby.ts`).
- The **Servers** tab still works: add, edit, delete, refresh, direct connect, and join a server by address. No server is built in, the list starts empty.

## Run locally

```bash
cd client-master
npm ci
npm run dev          # dev server on http://localhost:8080
# or, production build:
npm run build-prod
npm start            # serves ./out on http://localhost:8080
```

Requires Node.js 20+.

## Deploy on Railway

The repository root has a `Dockerfile` and `railway.json`, so no extra settings are needed.

1. Push this repository to GitHub.
2. Railway: **New Project → Deploy from GitHub repo** → pick the repo. Leave *Root Directory* empty (the Dockerfile is at the root).
3. Railway builds the image (`npm ci` + `npm run build-prod`) and starts `node server.js`, which listens on Railway's `$PORT`. The health check is `/healthz`.
4. **Settings → Networking → Generate Domain** to get the public URL.

No environment variables are required. Optional build variables:

| Variable | Effect |
| --- | --- |
| `GAME_SERVER` | Default address stored in the "Server Address" setting. Empty by default |
| `CLIENT_HASH` | Overrides the version string embedded in the build. Defaults to Railway's commit SHA |

Local Docker test: `docker build -t terrifront . && docker run -p 8080:8080 terrifront`

## Notes

- Default map data is cached in `client-master/resources/map-cache/` and committed, so builds work offline. Without the cache the build would try to download the maps from `warfront.io`.
- `npm run lint` reports existing code-style errors. CI shows them but does not fail on them.
- Community: https://discord.gg/upAywr74ff
