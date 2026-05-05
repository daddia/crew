# Build context is the workspace root.
# docker build -f crews/code-reviewer/Dockerfile -t crew-code-reviewer .

FROM node:24-slim AS base

RUN corepack enable

WORKDIR /workspace

# Layer 1: package manifests only — maximises cache reuse when source changes.
# packages/crew/package.json is included so that pnpm can resolve the workspace
# importer entry in pnpm-lock.yaml; @daddia/crew itself is installed from the
# npm registry (lockfile resolution: 0.1.0, not workspace:*).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tooling/typescript-config/package.json ./tooling/typescript-config/
COPY tooling/vitest-config/package.json     ./tooling/vitest-config/
COPY packages/crew/package.json             ./packages/crew/
COPY crews/code-reviewer/package.json       ./crews/code-reviewer/

RUN pnpm install --frozen-lockfile

# Layer 2: source — only the code-reviewer crew and shared tooling.
# packages/crew source is NOT copied; @daddia/crew is consumed from node_modules
# (npm registry) so the image does not depend on the workspace build of @daddia/crew.
COPY tsconfig.base.json ./
COPY tooling/           ./tooling/
COPY crews/code-reviewer/ ./crews/code-reviewer/

# Build in dependency order.
RUN pnpm --filter @repo/vitest-config       build
RUN pnpm --filter @daddia/crew-code-reviewer build

# Bundle the CLI with its production dependencies into a self-contained directory.
RUN cd crews/code-reviewer && pnpm deploy /deploy

# ---- runtime image ----
FROM node:24-slim AS runtime

WORKDIR /app

COPY --from=base /deploy .

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/cli.js"]
