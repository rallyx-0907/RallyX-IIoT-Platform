FROM node:22.16.0-bookworm-slim
WORKDIR /app/apps/connectivity
COPY apps/connectivity/package.json apps/connectivity/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node apps/connectivity/src ./src
COPY --chown=node:node packages/contracts /app/packages/contracts
USER node
EXPOSE 8090
CMD ["node", "src/server.mjs"]
