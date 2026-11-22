# TerriFront client: build the static game with webpack, then serve it with a tiny Node server.
# Used by Railway (see railway.json) and works locally: docker build -t terrifront . && docker run -p 8080:8080 terrifront

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app/client-master
# Railway passes the commit SHA as a build arg; the build embeds it as the client version
ARG RAILWAY_GIT_COMMIT_SHA
ENV RAILWAY_GIT_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA
COPY client-master/package.json client-master/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client-master/ ./
RUN npm run build-prod

# ---- run ----
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/client-master/out ./out
COPY client-master/server.js ./server.js
USER node
EXPOSE 8080
CMD ["node", "server.js"]
