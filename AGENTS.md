# AGENTS.md

This file gives AI coding agents the context needed to work effectively in this repository.

## What this is

A pnpm monorepo of autonomous delivery agents. Each agent unit is a self-contained, independently deployable service that uses the Claude Agent SDK to run software delivery tasks: picking up stories, implementing them, opening MRs, running peer review, addressing feedback, and closing the loop.

The architecture has two layers:

- **`agents/`** — deployable agent units. Each unit owns its server, workflow, state, handlers, and team of personas. A unit can be moved to its own repository by replacing `workspace:*` dependencies with published package versions.
- **`packages/`** — shared libraries. Pure TypeScript with no side effects on import. Only agents depend on packages; packages never depend on agents.

## Repository layout

```
agents/
  delivery/           # The delivery unit (tech-lead, engineer, senior-engineer)
    src/
      index.ts        # Hono server entry
      workflow.ts     # Delivery sequence: implement → peer-review → final-review
      state.ts        # SQLite store (stories, phases, webhook_events)
      observability.ts
      agents/         # Persona modules
        tech-lead/    # Final code review, triage
        engineer/     # Implementation, address-feedback
        senior-engineer/ # Peer review
      handlers/       # Inbound webhook handlers
        jira.ts       # POST /webhooks/jira
        gitlab.ts     # POST /webhooks/gitlab
      integrations/   # Thin idempotent clients for external systems
        jira.ts
        gitlab.ts
    mcp.json          # MCP server config (Atlassian, GitLab)
    Dockerfile
    package.json      # @daddia/agent-delivery

packages/
  crew/               # @daddia/crew — shared library (main entry + ./webhooks subpath)

tooling/
  typescript-config/  # @repo/typescript-config — shared TypeScript base configs
  vitest-config/      # @repo/vitest-config — shared Vitest configuration
```

## Key packages

### `@daddia/crew` (main entry)

Shared types and Claude Agent SDK helpers. Every persona module implements `Agent`. Every deployable service satisfies `AgentUnit`. Import session utilities and contract types from this package.

| Type | Purpose |
|---|---|
| `Agent` | Interface every persona `agent.ts` must export |
| `AgentUnit` | Interface every deployable unit must satisfy |
| `AgentInput` | `{ issueKey, context }` passed into every `agent.run()` |
| `AgentResult` | `{ success, summary, artefacts, costUsd }` returned by every run |
| `AgentDefinition` | Configuration passed to `resolveSession()` to boot a Claude session |
| `PersonaName` | `"tech-lead" \| "engineer" \| "senior-engineer" \| "code-quality"` |

| Export | Purpose |
|---|---|
| `resolveSession()` | Decide whether to create a new session or resume an existing one |
| `readPromptFile()` | Load a persona's `prompt.md` |
| `readSkillsDir()` | Discover `SKILL.md` files under a `.claude/skills/` tree |
| `readSubagentsDir()` | Discover subagent `.md` files under a `.claude/agents/` directory |
| `buildAuditHook()` | `PostToolUse` hook that enforces allowed-tools and logs every tool call |
| `boundedIterGuard()` | Guard that throws `IterationCapReached` when loop cap is hit |
| `IterationCapReached` | Error class for iteration cap exhaustion |

### `@daddia/crew/webhooks` (subpath)

Security primitives for inbound webhook handlers. Import only from this subpath in units that receive webhooks so consumers without ingress do not pull optional native dependencies.

| Export | Purpose |
|---|---|
| `verifySignature()` | HMAC (Jira) or shared-token (GitLab) verification |
| `checkReplayWindow()` | Reject replayed events outside a time window |
| `createIdempotencyStore()` | SQLite-backed deduplication keyed on `(provider, eventId)` |
| `SignatureError` | Thrown on signature mismatch |
| `ReplayError` | Thrown on replay detection |

## Development commands

Run from the repository root:

| Command | Description |
|---|---|
| `pnpm build` | Build all packages and agents |
| `pnpm typecheck` | Type-check everything |
| `pnpm test` | Run Vitest suite |
| `pnpm lint` | Enforce dependency boundaries with dependency-cruiser |
| `pnpm clean` | Remove build artefacts |

Per-unit commands (run inside `agents/{name}/`):

| Command | Description |
|---|---|
| `pnpm build` | Build this unit |
| `pnpm dev` | Start the server with `--watch` |
| `pnpm typecheck` | Type-check this unit |

## Dependency rules (enforced by dependency-cruiser)

These rules are non-negotiable. `pnpm lint` runs dependency-cruiser and must pass before a change merges; fix boundary violations rather than bypassing them.

1. `agents/*` may import from `packages/*` only. Never from another `agents/*`.
2. `packages/*` may not import from `agents/*`.
3. No circular dependencies within `packages/*`.

There is no GitHub Actions workflow in this repository yet; contributors rely on local `pnpm lint`. When CI is added (see product backlog CREW-51-002), it should run the same lint, typecheck, and test commands on every push and PR.

## Agent unit conventions

Every agent unit under `agents/` must follow this layout:

```
agents/{name}/
  src/
    index.ts          # Hono server; mounts handlers; handles SIGTERM/SIGINT
    workflow.ts       # Sequence logic; imports only agents from this unit
    state.ts          # SQLite schema and store; unit-owned, never shared
    observability.ts  # OTLP bootstrap + structured logger
    agents/           # Team members
      {persona}/
        agent.ts      # exports `const {persona}: Agent`
        prompt.md     # System prompt; no code
        .claude/
          skills/     # SKILL.md files loaded via readSkillsDir()
          agents/     # Subagent .md files loaded via readSubagentsDir()
    handlers/         # One file per inbound event source
    integrations/     # Idempotent clients for external systems
  mcp.json            # MCP server definitions for this unit
  Dockerfile
  package.json        # scoped as @daddia/agent-{name}
  tsconfig.json       # extends @repo/typescript-config/library
```

A solo unit (single agent, no team) uses the same shape but omits the inner `agents/` subdirectory.

## Persona conventions

Each `agent.ts` exports a single named `const` typed as `Agent`:

```typescript
export const engineer: Agent = {
  name: 'engineer',
  async run(input: AgentInput): Promise<AgentResult> { ... }
}
```

The `run` implementation:
- Calls `resolveSession()` from `@daddia/crew` to decide create vs resume.
- Builds an `AgentDefinition` from the persona's `promptPath`, `skillPaths`, `subagentPaths`, `allowedTools`, and `mcpServerNames`.
- Attaches `buildAuditHook()` from `@daddia/crew` for every run.
- Returns `AgentResult` with `success`, `summary`, `artefacts`, and `costUsd`.

Tool allowlists are enforced at two levels: the Claude Agent SDK `allowedTools` option, and the `buildAuditHook` belt-and-suspenders check.

## State store conventions

Each unit owns its own SQLite database (path injected via `DB_PATH` env var). The standard schema has three tables:

- `stories` — one row per story, tracking `current_phase`.
- `phases` — one row per phase execution, recording `session_id`, `started_at`, `finished_at`, `cost_usd`, `verdict`.
- `webhook_events` — deduplication log keyed on `(provider, event_id)`.

Write phase state **before** calling `agent.run()`, not after. This allows crash-recovery by scanning for phases with `started_at` set and `finished_at` null.

## Workflow conventions

`workflow.ts` is the only file that knows the delivery sequence. It imports personas directly from the local `agents/` folder. It never imports from another unit.

Escalation on failure or loop cap: call `commentOnIssue` + `transitionIssue("Needs human review")` and return. Never let the workflow throw to the caller.

The `REFACTOR_LOOP_CAP` env var (default: `2`) bounds the address-feedback loop. The cap applies to both the internal peer-review loop and the external-comment path.

## Webhook handler conventions

Every inbound handler must:
1. Call `verifySignature()` from `@daddia/crew/webhooks` before parsing the body.
2. Call `checkReplayWindow()` and `createIdempotencyStore()` to deduplicate.
3. Return `200` promptly; run the workflow asynchronously (fire-and-forget with error logging).
4. Never expose internal error details in the response body.

## MCP configuration

Each unit's `mcp.json` declares the MCP servers it needs. Environment variable interpolation uses `${VAR_NAME}` syntax. The SDK resolves these at session start. Do not hardcode credentials.

Currently configured servers:
- `atlassian` — Jira read/write via `@anthropic-ai/mcp-server-atlassian`
- `gitlab` — MR operations via `@anthropic-ai/mcp-server-gitlab`

## Agent guidance

- When adding a new persona, start with `agent.ts` and `prompt.md`. Add skills only once the persona runs correctly with a plain prompt.
- When changing the `Agent` or `AgentResult` interface in `@daddia/crew`, update all persona `agent.ts` files in the same PR.
- When changing webhook verification logic in `@daddia/crew/webhooks`, test against both Jira (HMAC) and GitLab (shared token) paths.
- When changing `workflow.ts`, check that escalation paths (loop cap, agent failure) transition Jira correctly and do not re-enter the workflow.
- Prefer modifying the smallest scope needed. A change to the delivery workflow should not touch shared types unless the contract truly changes.
- Run `pnpm lint` before pushing. Boundary violations must not merge.
