# Build context is the workspace root.
# docker build -f crews/delivery-qa/Dockerfile -t crew-delivery-qa .
#
# Requires Node >= 22.5.0. The node:sqlite module (used by state.ts) is
# experimental in Node 22 — an ExperimentalWarning is emitted at startup but
# the module is fully functional. Node 23+ removes the warning.

FROM node:22-slim AS base

RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY tooling/typescript-config/package.json ./tooling/typescript-config/
COPY tooling/vitest-config/package.json      ./tooling/vitest-config/
COPY packages/crew/package.json              ./packages/crew/
COPY crews/delivery-qa/package.json          ./crews/delivery-qa/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY tooling/           ./tooling/
COPY crews/delivery-qa/ ./crews/delivery-qa/

RUN pnpm --filter @repo/vitest-config     build
RUN pnpm --filter @daddia/crew-delivery-qa build

RUN set -e; cd crews/delivery-qa; \
    for f in $(find src -name "*.md" 2>/dev/null); do \
      rel="${f#src/}"; \
      mkdir -p "dist/$(dirname "$rel")"; \
      cp "$f" "dist/$rel"; \
    done

RUN cd crews/delivery-qa && pnpm deploy /deploy

FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=base /deploy .

RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/delivery-qa.db

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
