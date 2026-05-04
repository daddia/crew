# crew

Autonomous software delivery crew. A monorepo of agent units that pick up Jira stories, implement them, open GitLab MRs, run peer review, address feedback, and close the loop — end to end, without human intervention.

## Structure

```
agents/
  {unit}/
    src/
      agents/          # directory per persona - agent.ts, prompt.md, skills
      handlers/        # inbound webhook handlers
      integrations/    # idempotent clients for external systems
      index.ts         # Hono server entry
      workflow.ts      # delivery sequence
      state.ts         # SQLite store
      observability.ts
    mcp.json
    Dockerfile
packages/
  crew/              # @daddia/crew — shared types, session, loaders, hooks
                     # subpath @daddia/crew/webhooks — verify, replay, idempotency
tooling/             # shared eslint / typescript configs (workspace packages)
```

Units depend on packages. Packages never depend on units. No unit imports from another unit.

## Quick start

```bash
cp .env.example .env
cp agents/{unit}/.env.example agents/{unit}/.env
# fill in values in both files

pnpm install
pnpm build

cd agents/{unit}
pnpm start
```

The server starts on `PORT` (default `3000`). Point a Jira webhook (issue transitioned) and a GitLab webhook (MR note) at the running server.

## Quality & Testing

```bash
pnpm lint       # dependency-cruiser boundary checks
pnpm typecheck  # TypeScript across all packages and agents
pnpm test       # Vitest suite
```

## Contributing

See [`contributing/`](contributing/) for guides on adding personas, units, and packages.

## Licence

Copyright (c) 2026 daddia. All rights reserved. Released under the [MIT Licence](LICENCE).
