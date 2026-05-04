# Build context is the workspace root.
# docker build -f agents/code-reviewer/Dockerfile -t crew-code-reviewer .

FROM node:22-slim AS base
RUN npm install -g pnpm@9

WORKDIR /workspace

# Install workspace deps (package manifests only — no source yet).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tooling/typescript-config/package.json ./tooling/typescript-config/
COPY tooling/vitest-config/package.json ./tooling/vitest-config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/webhooks/package.json ./packages/webhooks/
COPY packages/crew/package.json ./packages/crew/
COPY agents/code-reviewer/package.json ./agents/code-reviewer/

RUN pnpm install --frozen-lockfile

# Copy source.
COPY tsconfig.base.json ./
COPY tooling/ ./tooling/
COPY packages/ ./packages/
COPY agents/code-reviewer/ ./agents/code-reviewer/

# Build in dependency order.
RUN pnpm --filter @repo/vitest-config build
RUN pnpm --filter @daddia/crew build
RUN pnpm --filter @daddia/agent-code-reviewer build

# ---- runtime image ----
FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=base /workspace/node_modules ./node_modules
COPY --from=base /workspace/packages ./packages
COPY --from=base /workspace/agents/code-reviewer ./agents/code-reviewer

WORKDIR /app/agents/code-reviewer

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/cli.js"]
