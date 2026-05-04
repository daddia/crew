# Build context is the workspace root.
# docker build -f agents/delivery/Dockerfile -t crew-delivery .

FROM node:22-slim AS base

# corepack reads the `packageManager` field from package.json and
# activates the exact pnpm version declared there.
RUN corepack enable

WORKDIR /workspace

# Layer 1: package manifests only — maximises cache reuse when source changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tooling/typescript-config/package.json ./tooling/typescript-config/
COPY tooling/vitest-config/package.json      ./tooling/vitest-config/
COPY packages/crew/package.json              ./packages/crew/
COPY agents/delivery/package.json            ./agents/delivery/

RUN pnpm install --frozen-lockfile

# Layer 2: source.
COPY tsconfig.base.json ./
COPY tooling/           ./tooling/
COPY packages/          ./packages/
COPY agents/delivery/   ./agents/delivery/

# Build in dependency order.
RUN pnpm --filter @repo/vitest-config        build
RUN pnpm --filter @daddia/crew                 build
RUN pnpm --filter @daddia/agent-delivery       build

# Mirror markdown assets (prompts, skills, subagents) into dist so that
# __dirname-relative lookups in agent.ts resolve correctly at runtime.
RUN set -e; cd agents/delivery; \
    for f in $(find src -name "*.md"); do \
      rel="${f#src/}"; \
      mkdir -p "dist/$(dirname "$rel")"; \
      cp "$f" "dist/$rel"; \
    done

# Bundle the service with its production dependencies into a self-contained
# directory. Workspace dependencies are bundled from their built dist/.
RUN cd agents/delivery && pnpm deploy /deploy

# ---- runtime image ----
FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=base /deploy .

# Persistent data directory — mount a Railway volume at /data and set
# DB_PATH=/data/delivery.db in the service's environment variables.
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/delivery.db

EXPOSE 3000

CMD ["node", "dist/index.js"]
