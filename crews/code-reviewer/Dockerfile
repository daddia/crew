# Build context is the workspace root.
# docker build -f crews/code-reviewer/Dockerfile -t crew-code-reviewer .

FROM node:22-slim AS base
RUN npm install -g pnpm@9

WORKDIR /workspace

# Install workspace deps (package manifests only — no source yet).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tooling/typescript-config/package.json ./tooling/typescript-config/
COPY tooling/vitest-config/package.json ./tooling/vitest-config/
COPY packages/crew/package.json ./packages/crew/
COPY crews/code-reviewer/package.json ./crews/code-reviewer/

RUN pnpm install --frozen-lockfile

# Copy source.
COPY tsconfig.base.json ./
COPY tooling/ ./tooling/
COPY packages/ ./packages/
COPY crews/code-reviewer/ ./crews/code-reviewer/

# Build in dependency order.
RUN pnpm --filter @repo/vitest-config build
RUN pnpm --filter @daddia/crew build
RUN pnpm --filter @daddia/crew-code-reviewer build

# ---- runtime image ----
FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=base /workspace/node_modules ./node_modules
COPY --from=base /workspace/packages ./packages
COPY --from=base /workspace/crews/code-reviewer ./crews/code-reviewer

WORKDIR /app/crews/code-reviewer

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/cli.js"]
