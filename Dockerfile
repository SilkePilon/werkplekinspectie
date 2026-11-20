# syntax=docker/dockerfile:1
# Werkplekinspectie: the Vite client and the Fastify server in one Node container.
# No secrets or build arguments: all settings come from env at runtime.

# 1. Install all dependencies exactly as in the lockfile.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2. Build the client and the server, then drop the dev dependencies.
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# 3. Runtime: only the build output and the production dependencies.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS runtime
LABEL org.opencontainers.image.title="werkplekinspectie" \
      org.opencontainers.image.description="Werkplekinspectie Arbo en Milieu als PWA: invullen op de telefoon, als PDF per mail versturen." \
      org.opencontainers.image.source="https://github.com/SilkePilon/werkplekinspectie" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production PORT=8080
WORKDIR /app
# npm is not needed at runtime; removing it shrinks the attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# Files stay owned by root, so the app user cannot change them.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node","dist/server/server/index.js"]
