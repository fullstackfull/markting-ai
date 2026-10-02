# adport cloud (Next.js standalone) image. Build context is ./platform.
# Upstream ships no Dockerfile; this follows platform/docs/cloud-local-development.md
# ("production-mode local check") and apps/cloud/package.json "build:standalone".

FROM node:22-bookworm-slim AS build
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm --filter @adport/cloud build:standalone

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# The standalone output is self-contained (traced node_modules included).
COPY --from=build /repo/apps/cloud/.next/standalone ./
COPY --from=build /repo/apps/cloud/.next/static ./apps/cloud/.next/static
COPY --from=build /repo/apps/cloud/public ./apps/cloud/public
EXPOSE 3000
USER node
CMD ["node", "apps/cloud/server.js"]
