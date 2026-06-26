# Crew

The runtime and catalogue for autonomous knowledge work. Crew turns specified workflows into independently deployable agent services that run unattended — picking up work, executing it, opening artefacts for review, addressing feedback, and closing the loop.

Delivery is the first vertical: stories in, merge requests out. The substrate underneath is built so every later crew inherits crash recovery, audit, bounded loops, escalation, and cost ceilings for free.

## Quick start

```bash
cp .env.example .env
cp crews/{crew}/.env.example crews/{crew}/.env
# fill in values in both files

pnpm install && pnpm build

cd crews/{crew}
pnpm start
```

The server starts on `PORT` (default `3000`). Point a Jira webhook (issue transitioned) and a GitLab webhook (MR note) at the running service.

## Repo at a glance

| Path                             | Purpose                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`crews/`](crews/)               | Deployable agent crews. One container or one published CLI per crew.                                 |
| [`packages/`](packages/)         | Shared libraries — published to npm.                                                                 |
| [`tooling/`](tooling/)           | Shared ESLint, Prettier, TypeScript, and Vitest configs.                                             |
| [`docs/`](docs/)                 | Product strategy, roadmap, solution architecture, delivery approach, flow contracts, runbooks, ADRs. |
| [`contributing/`](contributing/) | Step-by-step guides for adding personas and crews.                                                   |

Boundaries: crews depend on packages; packages never depend on crews; no crew imports another crew. Enforced by `pnpm lint`.

## Quality gates

```bash
pnpm lint       # dependency-cruiser boundary checks + ESLint
pnpm typecheck  # TypeScript across all packages and crews
pnpm test       # Vitest suite
```

CI runs the same gates on every PR.

## Where to next

- **What is Crew, why now, for whom** → [`docs/product/strategy.md`](docs/product/strategy.md)
- **How Crew is built and operated** → [`docs/architecture/solution.md`](docs/architecture/solution.md)
- **What ships when** → [`docs/product/roadmap.md`](docs/product/roadmap.md)
- **Coding agents working in this repo** → [`AGENTS.md`](AGENTS.md)

Full doc index: [`docs/README.md`](docs/README.md).

## Licence

Copyright (c) 2026 daddia. All rights reserved. Released under the [MIT Licence](LICENSE).
