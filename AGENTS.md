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
  crew/               # @daddia/crew — shared library (main + ./webhooks + ./config + ./state + ./workflow)
    src/
      index.ts        # Main entry: Agent, AgentCrew, resolveSession, hooks, observability, memory, Orchestrator
      agent.ts        # Agent, AgentInput, AgentResult, AgentDefinition, PersonaName
      unit.ts         # AgentCrew interface
      session.ts      # resolveSession, SessionOptions, ActiveSession
      hooks.ts        # buildAuditHook, toSDKHookCallback, boundedIterGuard, IterationCapReached
      orchestrator.ts # Orchestrator, OrchestratorRequest, AgentRegistry
      state/          # ./state subpath: StateStore interface + SQLite implementation
      workflow/       # ./workflow subpath: WorkflowEngine, WorkflowPlan, FailurePolicy
      webhooks/       # ./webhooks subpath: verifySignature, idempotency, replay
      config/         # ./config subpath: loadEnv, loadYaml, Secret, redact

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

| Export                      | Purpose                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| `resolveSession()`          | Decide whether to create a new session or resume an existing one           |
| `readPromptFile()`          | Load a persona's `prompt.md`                                               |
| `readSkillsDir()`           | Discover `SKILL.md` files under a `.claude/skills/` tree                   |
| `readSubagentsDir()`        | Discover subagent `.md` files under a `.claude/agents/` directory          |
| `buildAuditHook()`          | `PostToolUse` hook that enforces allowed-tools and logs every tool call    |
| `toSDKHookCallback()`       | Convert a `PostToolUseHandler` into the SDK's native hook callback format  |
| `boundedIterGuard()`        | Guard that throws `IterationCapReached` when loop cap is hit               |
| `IterationCapReached`       | Error class for iteration cap exhaustion                                   |
| `seedProjectMemory()`       | Seed project-level memory files into a persona's working context           |
| `createLogger()`            | Create a structured `Logger` instance scoped to a crew or module           |
| `initTracing()`             | Bootstrap OpenTelemetry tracing (call once at process start)               |
| `createTracer()`            | Obtain a scoped `Tracer` for a crew or module                              |
| `SessionOptions`            | Options passed to `resolveSession()`                                       |
| `ActiveSession`             | Return type of `resolveSession()`                                          |
| `SDKMessage`                | Re-exported SDK message union type                                         |
| `SDKResultMessage`          | Re-exported SDK result message type                                        |
| `ToolUseEvent`              | Payload passed to every `PostToolUseHandler`                               |
| `PostToolUseHandler`        | Handler signature for post-tool-use hooks                                  |
| `Logger` / `LogLevel`       | Structured logging types                                                   |
| `TracingOptions` / `Tracer` | OTel tracing types                                                         |
| `Orchestrator`              | Interface for dynamic workflow planners (deterministic or Claude-assisted) |
| `OrchestratorRequest`       | `{ issueKey, context }` passed to `Orchestrator.plan()`                    |
| `AgentRegistry`             | `Readonly<Record<string, Agent>>` — named agent lookup for orchestrators   |

### `@daddia/crew/webhooks` (subpath)

Security primitives for inbound webhook handlers. Import only from this subpath in crews that receive webhooks so consumers without ingress do not pull optional native dependencies.

| Export                     | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `verifySignature()`        | HMAC (Jira) or shared-token (GitLab) verification          |
| `checkReplayWindow()`      | Reject replayed events outside a time window               |
| `createIdempotencyStore()` | SQLite-backed deduplication keyed on `(provider, eventId)` |
| `SignatureError`           | Thrown on signature mismatch                               |
| `ReplayError`              | Thrown on replay detection                                 |

### `@daddia/crew/state` (subpath)

Persistent state management for server-shaped crews. Provides the `StateStore` interface and a ready-to-use SQLite implementation. Import from this subpath instead of rolling your own SQLite layer — the schema, WAL configuration, and crash-recovery conventions are provided out of the box.

| Export                           | Purpose                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `StateStore`                     | Interface every state store implementation must satisfy                                                |
| `StoryRow`                       | Row type for the `stories` table (`issueKey`, `currentStep`, `startedAt`)                              |
| `StepRow`                        | Row type for the `steps` table (execution record with timing and cost)                                 |
| `StepResult`                     | `{ costUsd?, verdict? }` passed to `finishStep()`                                                      |
| `createSqliteStateStore(dbPath)` | Returns a `StateStore` backed by SQLite with WAL mode, prepared statements, and the three-table schema |

### `@daddia/crew/workflow` (subpath)

Structured execution engine for multi-step workflows. Wire up a `WorkflowPlan` and let the engine handle step sequencing, context accumulation, retry logic, and failure escalation. Use this instead of hand-rolling the run loop in `workflow.ts`.

| Export                          | Purpose                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `WorkflowPlan`                  | `{ issueKey, steps }` — the complete execution plan for one story                                    |
| `WorkflowStep`                  | `{ name, agent, maxRetries?, onFailure? }` — one step in the plan                                    |
| `FailurePolicy`                 | `'escalate' \| 'continue' \| 'stop'` — what to do when a step fails after retries                    |
| `WorkflowEngine`                | Interface returned by `createWorkflowEngine()` — has a single `run(plan, context?)` method           |
| `WorkflowEngineOptions`         | `{ store, onEscalate, logger? }` — configuration passed to `createWorkflowEngine()`                  |
| `createWorkflowEngine(options)` | Returns a `WorkflowEngine` that writes state, accumulates context, and calls `onEscalate` on failure |

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

CI runs on every push and PR (`.github/workflows/ci.yml`): format check, lint, typecheck, dependency audit, and tests must all pass before a PR can merge.

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

Each crew owns its own SQLite database (path injected via `DB_PATH` env var). Use `createSqliteStateStore(dbPath)` from `@daddia/crew/state` rather than rolling a bespoke SQLite layer — it provisions the standard schema and enforces the conventions below automatically.

The standard schema has three tables:

- `stories` — one row per story, tracking `current_step` and `started_at`.
- `steps` — one row per step execution, recording `session_id`, `started_at`, `finished_at`, `cost_usd`, `verdict`.
- `webhook_events` — deduplication log keyed on `(provider, event_id)`.

Each crew's `state.ts` should initialise the store and export a singleton — do not share the database file or store instance across crews.

**Crash-recovery ordering:**

Call `state.upsertStory(issueKey, step)` **before** `agent.run()`. This is the canonical in-flight signal: a `stories` row whose `current_step` has no matching finished `steps` row indicates an interrupted run.

For non-agent steps (API calls, integrations), also call `state.startStep(issueKey, step)` before the work begins, so the `steps` table reflects the start time accurately.

For agent steps whose `AgentResult` contains a `sessionId` artefact, call `state.startStep(issueKey, step, sessionId)` **after** `agent.run()` returns so the session ID is captured in the same row. The accepted trade-off is that `started_at` and `finished_at` for that step will be nearly identical (both timestamped at completion), and if the process crashes during the run there will be no `steps` row — but the `stories` row (written before the run) is still sufficient to detect the interrupted story.

## Workflow conventions

`workflow.ts` is the only file that knows the delivery sequence. It imports personas directly from the local `agents/` folder. It never imports from another crew.

For new server-shaped crews, prefer `createWorkflowEngine()` from `@daddia/crew/workflow`. Pass it a `WorkflowPlan` (list of `WorkflowStep` objects with `name`, `agent`, optional `maxRetries`, and optional `onFailure` policy). The engine writes crash-recovery markers via the `StateStore`, accumulates step artefacts into a shared context, handles retries, and calls your `onEscalate` callback on unrecoverable failure. Each step's `onFailure` can be `'escalate'` (default), `'continue'`, or `'stop'`.

Hand-rolled `workflow.ts` files (as in `delivery-build`) remain valid — they follow the same sequencing rules. The engine is a convenience layer, not a requirement.

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
- When changing `StateStore` or `WorkflowEngine` interfaces in `@daddia/crew`, bump the version, publish, and update every crew that uses those subpaths in the same PR.
- When changing webhook verification logic in `@daddia/crew/webhooks`, test against both Jira (HMAC) and GitLab (shared token) paths.
- When changing `workflow.ts`, check that escalation paths (loop cap, agent failure) transition Jira correctly and do not re-enter the workflow.
- When implementing a new `Orchestrator`, return a `WorkflowPlan` with the exact step names the crew's `StateStore` expects — step names are stored in SQLite and used for crash-recovery lookups.
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

## Documentation

Start with [`docs/README.md`](docs/README.md).

| Area | Path |
|------|------|
| Product strategy | `docs/product/product.md` |
| Product roadmap | `docs/product/roadmap.md` |
| Solution architecture | `architecture/solution.md` |
| ADRs | `architecture/decisions/` |
| Crew flow contracts | `docs/design/crew-flows/` |
| Contributor guides | `contributing/` |
| Delivery approach | `docs/delivery/approach.md` |
| Runbooks | `docs/runbook/` |
| Research and ideas | [Confluence CREW space](https://carinyaparc.atlassian.net/wiki/spaces/CREW/pages/753668/03+Research) |

The former `crew-space` repository is **decommissioned**; do not add new artefacts there.

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
