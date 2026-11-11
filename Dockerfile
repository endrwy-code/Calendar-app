# Daybook: the app, its server and the Telegram bot in one small image.
# Data lives in /data (mount a volume there). See DEPLOY.md.

FROM node:26.13.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# No dependency needs an install script; skipping them closes a supply-chain door.
RUN npm ci --ignore-scripts
COPY . .
RUN npm test && npm run build && npm run build:server

FROM node:26.13.0-alpine
ENV NODE_ENV=production TZ=UTC PORT=8080 DATA_DIR=/data
WORKDIR /app
# The server is bundled into one file, so no node_modules are needed at runtime.
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health > /dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/server.mjs"]
