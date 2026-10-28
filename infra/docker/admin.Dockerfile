# syntax=docker/dockerfile:1.7
# Image de l'administration web (Next.js en mode « standalone »).
# Construction depuis la racine du dépôt : docker build -f infra/docker/admin.Dockerfile .

FROM node:22.22.0-alpine AS base
# Derrière un proxy d'entreprise : passer HTTPS_PROXY en --build-arg et le certificat d'autorité du proxy
# en secret (--secret id=extra_ca,src=chemin/ca.crt). Sans proxy, ces deux options sont inutiles.
ENV NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca NODE_USE_ENV_PROXY=1
RUN --mount=type=secret,id=extra_ca,required=false npm install -g --no-fund --no-audit pnpm@10.28.0
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY admin/package.json admin/
COPY design/package.json design/
RUN --mount=type=secret,id=extra_ca,required=false pnpm install --frozen-lockfile --filter @ineed/admin...
COPY design design
COPY admin admin
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=extra_ca,required=false pnpm --filter @ineed/admin build

FROM node:22.22.0-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/admin/.next/static ./admin/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3001/ || exit 1
CMD ["node", "admin/server.js"]
