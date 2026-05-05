# Build context is the workspace root.
# docker build -f crews/delivery/Dockerfile -t crew-delivery .

FROM node:22-slim AS base

# corepack reads the `packageManager` field from package.json and
# activates the exact pnpm version declared there.
RUN corepack enable

WORKDIR /workspace

# Layer 1: package manifests only — maximises cache reuse when source changes.
# packages/crew/package.json is included so that pnpm can resolve the workspace
# importer entry in pnpm-lock.yaml; @daddia/crew itself is installed from the
# npm registry (lockfile resolution: 0.1.0, not workspace:*).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tooling/typescript-config/package.json ./tooling/typescript-config/
COPY tooling/vitest-config/package.json      ./tooling/vitest-config/
COPY packages/crew/package.json              ./packages/crew/
COPY crews/delivery/package.json             ./crews/delivery/

RUN pnpm install --frozen-lockfile

# Layer 2: source — only the delivery crew and shared tooling.
# packages/crew source is NOT copied; @daddia/crew is consumed from node_modules
# (npm registry) so the image does not depend on the workspace build of @daddia/crew.
COPY tsconfig.base.json ./
COPY tooling/           ./tooling/
COPY crews/delivery/    ./crews/delivery/

# Build in dependency order.
RUN pnpm --filter @repo/vitest-config    build
RUN pnpm --filter @daddia/crew-delivery  build

# Mirror markdown assets (prompts, skills, subagents) into dist so that
# __dirname-relative lookups in agent.ts resolve correctly at runtime.
RUN set -e; cd crews/delivery; \
    for f in $(find src -name "*.md"); do \
      rel="${f#src/}"; \
      mkdir -p "dist/$(dirname "$rel")"; \
      cp "$f" "dist/$rel"; \
    done

# Bundle the service with its production dependencies into a self-contained
# directory. @daddia/crew from the registry is included automatically.
RUN cd crews/delivery && pnpm deploy /deploy

# ---- runtime image ----
FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=base /deploy .

# Persistent data directory — mount a volume at /data and set
# DB_PATH=/data/delivery.db in the environment.
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/delivery.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
