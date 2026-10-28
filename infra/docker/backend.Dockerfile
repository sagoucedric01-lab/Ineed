# syntax=docker/dockerfile:1.7
# Image de l'API et du worker Ineed (même image, commande différente).
# Cibles : `runtime` (API/worker, dépendances de production seulement) et `tools` (migrations et seeds).
# Construction depuis la racine du dépôt : docker build -f infra/docker/backend.Dockerfile --target runtime .

FROM node:22.22.0-alpine AS base
# Derrière un proxy d'entreprise : passer HTTPS_PROXY en --build-arg et le certificat d'autorité du proxy
# en secret (--secret id=extra_ca,src=chemin/ca.crt). Sans proxy, ces deux options sont inutiles.
ENV NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca NODE_USE_ENV_PROXY=1
RUN --mount=type=secret,id=extra_ca,required=false npm install -g --no-fund --no-audit pnpm@10.28.0
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
COPY design/package.json design/
RUN --mount=type=secret,id=extra_ca,required=false pnpm install --frozen-lockfile --filter @ineed/backend...

FROM deps AS build
COPY backend backend
RUN --mount=type=secret,id=extra_ca,required=false pnpm --filter @ineed/backend build \
 && pnpm --filter @ineed/backend deploy --prod --legacy /out \
 && cp -r backend/dist /out/dist

# Migrations et seeds : `prisma migrate deploy` puis seed du référentiel (le seed lit design/copy).
FROM build AS tools
COPY design/copy design/copy
WORKDIR /repo/backend
USER node
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node_modules/.bin/tsx prisma/seed/run.ts"]

FROM node:22.22.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT:-3000}/health/live || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
