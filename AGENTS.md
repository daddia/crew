# AGENTS.md

This file gives AI coding agents the context needed to work effectively in this repository.

## What this is

A pnpm monorepo of autonomous delivery agents. Each agent crew is a self-contained, independently deployable service that uses the Claude Agent SDK to run software delivery tasks: picking up stories, implementing them, opening MRs, running peer review, addressing feedback, and closing the loop.

The architecture has two layers:

- **`crews/`** — deployable agent crews. Each crew owns its server, workflow, state, handlers, and team of personas. Each crew depends on the **published npm version** of `@daddia/crew`, not `workspace:*`. The Docker build installs `@daddia/crew` from the registry so the image is independent of the monorepo build.
- **`packages/`** — shared libraries. Pure TypeScript with no side effects on import. Only crews depend on packages; packages never depend on crews.

> **MUST**: Crews MUST NOT import `@daddia/crew` from the workspace. `@daddia/crew` MUST be consumed as an installed npm package. Crew `package.json` files MUST pin a registry version (e.g. `"@daddia/crew": "0.2.0"`) and MUST NOT use the `workspace:` protocol for `@daddia/crew`. To consume new `@daddia/crew` changes in a crew, bump the `@daddia/crew` package version, publish it to the registry, then update the crew's pinned dependency in the same PR. CI runs against published artefacts, so unpublished changes will fail typecheck even if they pass locally.

## Repository layout

```
crews/
  delivery-build/     # Build crew: context-seed → implement → peer-review → address-feedback → open-mr → ci-check → in-qa
    src/
      index.ts        # Hono server entry
      workflow.ts     # Build sequence: context-seed → implement → peer-review → open-mr → ci-check → in-qa
      state.ts        # SQLite store (stories, steps, webhook_events) via node:sqlite
      memory.ts       # Project memory seeding for the engineer persona
      observability.ts  # Exports log (createLogger) and tracer (createTracer); calls initTracing() in index.ts boot
      idempotency.ts  # Lazy singleton wrapping createIdempotencyStore()
      agents/         # Persona modules
        engineer/     # Implementation, address-feedback
        senior-engineer/ # Peer review
      handlers/       # Inbound webhook handlers
        jira.ts       # POST /webhooks/jira  (trigger: "Ready for Dev" transition)
        gitlab.ts     # POST /webhooks/gitlab (trigger: MR note events)
      integrations/   # Thin idempotent clients for external systems
        jira.ts
        gitlab.ts
    mcp.json          # MCP server config (Atlassian, GitLab)
    Dockerfile
    package.json      # @daddia/crew-delivery-build

  delivery-review/    # Review crew: final-code-review → stakeholder-review → merge (scaffolded)
    src/
      index.ts        # Hono server entry (port 3001 by default)
      workflow.ts     # Review sequence stub (not yet implemented)
      state.ts        # SQLite store via node:sqlite
      observability.ts  # Exports log (createLogger) and tracer (createTracer)
    package.json      # @daddia/crew-delivery-review

packages/
  crew/               # @daddia/crew — shared library (main entry + ./webhooks subpath)

tooling/
  typescript-config/  # @repo/typescript-config — shared TypeScript base configs
  vitest-config/      # @repo/vitest-config — shared Vitest configuration
```

## Key packages

### `@daddia/crew` (main entry)

Shared types and Claude Agent SDK helpers. Every persona module implements `Agent`. Every deployable service satisfies `AgentCrew`. Import session utilities and contract types from this package.

| Type              | Purpose                                                             |
| ----------------- | ------------------------------------------------------------------- |
| `Agent`           | Interface every persona `agent.ts` must export                      |
| `AgentCrew`       | Interface every deployable crew must satisfy                        |
| `AgentInput`      | `{ issueKey, context }` passed into every `agent.run()`             |
| `AgentResult`     | `{ success, summary, artefacts, costUsd }` returned by every run    |
| `AgentDefinition` | Configuration passed to `resolveSession()` to boot a Claude session |
| `PersonaName`     | `"tech-lead" \| "engineer" \| "senior-engineer" \| "code-quality"`  |

| Export                | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `resolveSession()`    | Decide whether to create a new session or resume an existing one        |
| `readPromptFile()`    | Load a persona's `prompt.md`                                            |
| `readSkillsDir()`     | Discover `SKILL.md` files under a `.claude/skills/` tree                |
| `readSubagentsDir()`  | Discover subagent `.md` files under a `.claude/agents/` directory       |
| `buildAuditHook()`    | `PostToolUse` hook that enforces allowed-tools and logs every tool call |
| `boundedIterGuard()`  | Guard that throws `IterationCapReached` when loop cap is hit            |
| `IterationCapReached` | Error class for iteration cap exhaustion                                |

### `@daddia/crew/webhooks` (subpath)

Security primitives for inbound webhook handlers. Import only from this subpath in crews that receive webhooks so consumers without ingress do not pull optional native dependencies.

| Export                     | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `verifySignature()`        | HMAC (Jira) or shared-token (GitLab) verification          |
| `checkReplayWindow()`      | Reject replayed events outside a time window               |
| `createIdempotencyStore()` | SQLite-backed deduplication keyed on `(provider, eventId)` |
| `SignatureError`           | Thrown on signature mismatch                               |
| `ReplayError`              | Thrown on replay detection                                 |

## Development commands

Run from the repository root:

| Command          | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `pnpm build`     | Build all packages and crews                          |
| `pnpm typecheck` | Type-check everything                                 |
| `pnpm test`      | Run Vitest suite                                      |
| `pnpm lint`      | Enforce dependency boundaries with dependency-cruiser |
| `pnpm clean`     | Remove build artefacts                                |

Per-crew commands (run inside `crews/{name}/`):

| Command          | Description                     |
| ---------------- | ------------------------------- |
| `pnpm build`     | Build this crew                 |
| `pnpm dev`       | Start the server with `--watch` |
| `pnpm typecheck` | Type-check this crew            |

## Dependency rules (enforced by dependency-cruiser)

These rules are non-negotiable. `pnpm lint` runs dependency-cruiser and must pass before a change merges; fix boundary violations rather than bypassing them.

1. `crews/*` may import from `packages/*` only. Never from another `crews/*`.
2. `packages/*` may not import from `crews/*`.
3. No circular dependencies within `packages/*`.
4. `crews/*` MUST consume `@daddia/crew` as a published npm dependency. Workspace linking (`workspace:*`, `workspace:^`, `link:`) is forbidden for `@daddia/crew` in any crew `package.json`.

There is no GitHub Actions workflow in this repository yet; contributors rely on local `pnpm lint`. When CI is added (see product backlog CREW-51-002), it should run the same lint, typecheck, and test commands on every push and PR.

## Agent crew conventions

Every agent crew under `crews/` must follow this layout:

```
crews/{name}/
  src/
    index.ts          # Hono server; mounts handlers; handles SIGTERM/SIGINT
    workflow.ts       # Sequence logic; imports only agents from this crew
    state.ts          # SQLite schema and store; crew-owned, never shared
    observability.ts  # Exports log = createLogger(name) and tracer = createTracer(name); index.ts calls initTracing() at boot
    agents/           # Team members
      {persona}/
        agent.ts      # exports `const {persona}: Agent`
        prompt.md     # System prompt; no code
        .claude/
          skills/     # SKILL.md files loaded via readSkillsDir()
          agents/     # Subagent .md files loaded via readSubagentsDir()
    handlers/         # One file per inbound event source
    integrations/     # Idempotent clients for external systems
  mcp.json            # MCP server definitions for this crew
  Dockerfile
  package.json        # scoped as @daddia/crew-{name}
  tsconfig.json       # extends @repo/typescript-config/library
```

A solo crew (single agent, no team) uses the same shape but omits the inner `agents/` subdirectory.

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

Each crew owns its own SQLite database (path injected via `DB_PATH` env var). The standard schema has three tables:

- `stories` — one row per story, tracking `current_step` and `updated_at`.
- `steps` — one row per step execution, recording `session_id`, `started_at`, `finished_at`, `cost_usd`, `verdict`.
- `webhook_events` — deduplication log keyed on `(provider, event_id)`.

**Crash-recovery ordering:**

Call `state.upsertStory(issueKey, step)` **before** `agent.run()`. This is the canonical in-flight signal: a `stories` row whose `current_step` has no matching finished `steps` row indicates an interrupted run.

For non-agent steps (API calls, integrations), also call `state.startStep(issueKey, step)` before the work begins, so the `steps` table reflects the start time accurately.

For agent steps whose `AgentResult` contains a `sessionId` artefact, call `state.startStep(issueKey, step, sessionId)` **after** `agent.run()` returns so the session ID is captured in the same row. The accepted trade-off is that `started_at` and `finished_at` for that step will be nearly identical (both timestamped at completion), and if the process crashes during the run there will be no `steps` row — but the `stories` row (written before the run) is still sufficient to detect the interrupted story. A future `recordSessionId` method could eliminate this trade-off.

## Workflow conventions

`workflow.ts` is the only file that knows the delivery sequence. It imports personas directly from the local `agents/` folder. It never imports from another crew.

Escalation on failure or loop cap: call `commentOnIssue` + `transitionIssue("Needs human review")` and return. Never let the workflow throw to the caller.

The `REFACTOR_LOOP_CAP` env var (default: `2`) limits how many `address-feedback` passes run in the internal peer-review loop. With cap `N`, the `for` loop in `workflow.ts` allows up to `N+1` senior-engineer (`peer-code-review`) calls—iterations `0` through `N`—but at most `N` engineer (`address-feedback`) calls: on the last iteration, peer review still runs, then the loop exits before another feedback pass. The same cap applies to the external-comment path (`addressFeedback`).

## Webhook handler conventions

Every inbound handler must:

1. Call `verifySignature()` from `@daddia/crew/webhooks` before parsing the body.
2. Call `checkReplayWindow()` and `createIdempotencyStore()` to deduplicate.
3. Return `200` promptly; run the workflow asynchronously (fire-and-forget with error logging).
4. Never expose internal error details in the response body.

## MCP configuration

Each crew's `mcp.json` declares the MCP servers it needs. Environment variable interpolation uses `${VAR_NAME}` syntax. The SDK resolves these at session start. Do not hardcode credentials.

Currently configured servers:

- `atlassian` — Jira read/write via `@anthropic-ai/mcp-server-atlassian`
- `gitlab` — MR operations via `@anthropic-ai/mcp-server-gitlab`

## Agent guidance

- When adding a new persona, start with `agent.ts` and `prompt.md`. Add skills only once the persona runs correctly with a plain prompt.
- When changing the `Agent` or `AgentResult` interface in `@daddia/crew`, bump the `@daddia/crew` version, publish it, bump every crew's pinned `@daddia/crew` dependency, and update all persona `agent.ts` files — all in the same PR.
- When changing webhook verification logic in `@daddia/crew/webhooks`, test against both Jira (HMAC) and GitLab (shared token) paths.
- When changing `workflow.ts`, check that escalation paths (loop cap, agent failure) transition Jira correctly and do not re-enter the workflow.
- Prefer modifying the smallest scope needed. A change to the delivery workflow should not touch shared types unless the contract truly changes.
- Run `pnpm lint` before pushing. Boundary violations must not merge.

---

## Code style

**Types:** `interface` for object contracts (agents, stores, clients); `type` for string unions, aliases, and utility derivations. No `enum` — use string union types throughout.

**Imports:** Use `import type` for type-only imports. Relative imports must include the `.js` extension (`"./state.js"`) — `moduleResolution` is `NodeNext`. Named exports only; no `export default` in `src/**`.

**Null safety:** `strict` and `noUncheckedIndexedAccess` are on. Do not use `!` non-null assertions without a comment explaining the invariant. Prefer narrowing or early returns.

**Env vars:** All `process.env` reads go through `loadConfig(env)` in `config.ts`. ESLint bans direct reads elsewhere in `src/**`. Wrap credential fields in `Secret()` so they are redacted from logs. `boot()` accepts `env` as a parameter so tests can inject without touching `process.env`.

**Logging:** Import `log` from `./observability.js` — never call `createLogger` in individual modules. Always include `issueKey` on story-scoped lines. Serialise errors as `String(err)`. Use dot-namespaced messages for structured events (`"workflow.complete"`). Never log tokens, secrets, or unvalidated request bodies.

**Naming:** Files `kebab-case.ts`; types `PascalCase`; variables/functions `camelCase`; compile-time sentinels `SCREAMING_SNAKE_CASE`. SQL columns `snake_case`, bridged to camelCase via `SELECT col AS camelName`. `Step` values and persona names use `kebab-case` and must correspond 1-to-1 with Jira transition names.

**Error handling by layer:**

| Layer           | Pattern                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `agent.ts`      | Return `AgentResult { success: false }`. Do not throw to the workflow.      |
| `integrations/` | Throw typed subclasses (`JiraApiError`, `GitLabApiError`).                  |
| `config.ts`     | Zod + `SchemaValidationError`. Fail fast at boot.                           |
| `workflow.ts`   | `try/catch` every step; on catch call `escalateToHumanReview` and return.   |
| `handlers/`     | Structured JSON errors only. No stack traces or internal details in bodies. |

**Testing:** `vi.mock` calls go at the top of the file before imports; re-import the subject after. Use `satisfies` on factory helpers for type-safe mocks. Test handlers via `app.request()`. New workflow branches (escalation, loop cap, deduplication) require unit tests; agent integration tests are not required per PR.

## Pre-merge checklist

- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm lint` passes (dependency-cruiser + ESLint — no boundary violations, no `process.env` leaks).
- `upsertStory` called before `agent.run()` on every agent step.
- Every failure branch calls `escalateToHumanReview` and returns; none rethrow to the HTTP layer.
- `verifySignature` is the first operation in every webhook handler.
- No hardcoded credentials, tokens, or secrets anywhere in source.
- Agent `context` is built from trusted integration outputs, not raw webhook payloads.
- If `@daddia/crew` was bumped: published to registry and all crew pinned deps updated in the same PR.
