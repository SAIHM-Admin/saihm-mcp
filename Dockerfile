# syntax=docker/dockerfile:1.7
# SAIHM MCP Server (thin client) - stdio transport.
# Glama-compatible: server starts without env vars; listTools works for
# introspection. Env vars (SAIHM_ENDPOINT_URL, SAIHM_AUTH_HEADER) are read
# lazily on first tool invocation, not at startup.

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
USER node
CMD ["node", "dist/saihm_mcp_server.js"]
