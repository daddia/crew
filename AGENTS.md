# AGENTS.md

Code conventions for AI agents (and humans) writing code in this repository. This is the **current-state, operational** reference. For the why behind these conventions, read [`docs/architecture/solution.md`](docs/architecture/solution.md); for what is being built next, read [`docs/product/roadmap.md`](docs/product/roadmap.md).

## What this repo is

A pnpm monorepo that ships autonomous agent crews. Each crew is an independently deployable service (a long-lived container today; a published npm CLI for stateless crews) built on a shared runtime, `@daddia/crew`.

Two layers:

- **`crews/`** — deployable agent crews. Each crew owns its entry point, workflow, state, handlers, and team of personas. Each crew depends on the **published npm version** of `@daddia/crew`, not `workspace:*`.
- **`packages/`** — shared libraries. Pure TypeScript, no side effects on import. Crews depend on packages; packages never depend on crews.

> **MUST**: Crews MUST consume `@daddia/crew` as an installed npm package. Crew `package.json` files MUST pin a registry version (e.g. `"@daddia/crew": "0.4.0"`) and MUST NOT use the `workspace:` protocol for `@daddia/crew`. To consume new changes, bump `@daddia/crew`, publish it, then update each crew's pinned dependency — all in the same PR. CI runs against published artefacts; unpublished changes will fail typecheck even if they pass locally.

## Crews in this repo

| Folder (code)                  | Role                                                              | Planned name (architecture / docs) | Status        |
| ------------------------------ | ----------------------------------------------------------------- | ---------------------------------- | ------------- |
| `crews/delivery-build/`        | Pick up story → implement → peer review → open MR → CI → hand off | `delivery-build`                   | Implemented   |
| `crews/delivery-qa/`           | Deploy to QA → automated + exploratory pass → defect loop → hand off | `delivery-qa`                   | Implemented   |
| `crews/delivery-review/`       | Tech-lead final review → PM HITL → merge → Done                   | `delivery-review`                  | Scaffold only |
| `crews/delivery-code-review/`  | Standalone code-review crew (post-MR, planned CLI-shaped)         | `code-reviewer`                    | Scaffold only |

Flow contracts for the full vertical live in [`docs/design/crew-flows/`](docs/design/crew-flows/).

## Repository layout

```
crews/
  delivery-build/          # Implemented build crew
    src/
      index.ts             # Hono server entry
      config.ts            # Typed env schema (only file that reads process.env)
      workflow.ts          # Sequence: context-seed → implement → peer-review → open-mr → ci-check → hand-off
      state.ts             # SQLite store via @daddia/crew/state
      poller.ts            # Jira poll loop (primary trigger)
      memory.ts            # Project memory seeding for the engineer persona
      observability.ts     # log = createLogger(name); tracer = createTracer(name); initTracing() at boot
      idempotency.ts       # Lazy singleton wrapping createIdempotencyStore()
      agents/              # Persona modules
        engineer/          # Implement, address-feedback, assess-clarification
        senior-engineer/   # Peer code review
      handlers/            # Inbound webhook handlers
        jira.ts            # POST /webhooks/jira  (issue transitions)
        gitlab.ts          # POST /webhooks/gitlab (MR note events)
      integrations/        # Idempotent clients for external systems
        jira.ts
        gitlab.ts
    mcp.json               # MCP server config (Atlassian, GitLab)
    Dockerfile
    package.json           # @daddia/crew-delivery-build

  delivery-qa/             # Implemented QA crew (In QA → In Review)
    src/
      index.ts             # Hono server entry
      config.ts            # Typed env schema (only file that reads process.env)
      workflow.ts          # Sequence: context-seed → deploy-qa → automated suite → exploratory → defect loop → hand-off
      state.ts             # SQLite store via @daddia/crew/state
      poller.ts            # Jira poll loop (fallback trigger)
      qa-workspace.ts      # Ephemeral QA workspace for deploy + suite runs
      observability.ts     # log = createLogger(name); tracer = createTracer(name); initTracing() at boot
      idempotency.ts       # Lazy singleton wrapping createIdempotencyStore()
      agents/
        qa-engineer/       # Deploy, suite, exploratory, document-defects
      handlers/
        jira.ts            # POST /webhooks/jira (issue transitions)
      integrations/
        jira.ts
        gitlab.ts
    evals/                 # Fixture-owned CrewBench evals (*.eval.ts)
    mcp.json
    Dockerfile
    package.json           # @daddia/crew-delivery-qa

  delivery-code-review/    # Scaffold — see crew README
  delivery-review/         # Scaffold — see crew README

packages/
  crew/                    # @daddia/crew — published shared library
                           #   main + ./webhooks + ./config + ./state + ./workflow
tooling/
  typescript-config/       # @repo/typescript-config
  vitest-config/           # @repo/vitest-config
  eslint-config/           # @repo/eslint-config
  prettier-config/         # @repo/prettier-config
```

## `@daddia/crew` surface

Every persona module implements `Agent`. Every deployable service satisfies `AgentCrew`. The package source is the authoritative API reference; this table lists the entry points an agent needs to know about.

| Subpath                 | What you get                                                                                                                                                                                                                                                                                                                                         | When to import it                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `@daddia/crew`          | `Agent`, `AgentCrew`, `AgentInput`, `AgentResult`, `AgentDefinition`, `PersonaName`, `resolveSession`, `readPromptFile`, `readSkillsDir`, `readSubagentsDir`, `buildAuditHook`, `toSDKHookCallback`, `boundedIterGuard`, `IterationCapReached`, `seedProjectMemory`, `createLogger`, `initTracing`, `createTracer`, `Orchestrator`, `AgentRegistry`. | Every crew, every persona.                                                      |
| `@daddia/crew/webhooks` | `verifySignature`, `checkReplayWindow`, `createIdempotencyStore`, `SignatureError`, `ReplayError`.                                                                                                                                                                                                                                                   | Server-shaped crews that accept inbound webhooks.                               |
| `@daddia/crew/state`    | `StateStore`, `StoryRow`, `StepRow`, `StepResult`, `createSqliteStateStore(dbPath)`.                                                                                                                                                                                                                                                                 | Server-shaped crews; do not roll your own SQLite layer.                         |
| `@daddia/crew/workflow` | `WorkflowPlan`, `WorkflowStep`, `FailurePolicy`, `WorkflowEngine`, `WorkflowEngineOptions`, `createWorkflowEngine(options)`.                                                                                                                                                                                                                         | New crews — prefer the engine over hand-rolled run loops.                       |
| `@daddia/crew/evals`    | `defineEval`, `createEvalFetchHandler`, `runEvalSession`, gate/soft assertions, JUnit reporter; `crew eval` CLI.                                                                                                                                                                                                                                     | CrewBench fixture-owned evals per crew; mount `/eval/*` on server-shaped crews. |
| `@daddia/crew/config`   | `loadEnv`, `loadYaml`, `Secret`, `redact`, `SchemaValidationError`, `ConfigNotFoundError`.                                                                                                                                                                                                                                                           | Every crew (typed config schema).                                               |

`@daddia/crew/control` (Pro-tier managed control plane) is described in [`docs/architecture/solution.md`](docs/architecture/solution.md) as a future surface. It is **not** shipped yet.

## Crew conventions

Every server-shaped crew under `crews/` must follow this layout:

```
crews/{name}/
  src/
    index.ts               # Hono server; loads config; mounts handlers; SIGTERM/SIGINT
    config.ts              # Typed schema; only file that reads process.env
    workflow.ts            # Sequence; imports only this crew's personas
    state.ts               # createSqliteStateStore(DB_PATH); crew-owned, never shared
    observability.ts       # log = createLogger(name); tracer = createTracer(name)
    agents/{persona}/
      agent.ts             # exports `const {persona}: Agent`
      prompt.md            # System prompt; no code
      plugin/
        skills/            # SKILL.md files loaded via readSkillsDir()
        agents/            # Subagent .md files loaded via readSubagentsDir()
        .claude-plugin/    # SDK plugin manifest when required
    handlers/              # One file per inbound event source
    integrations/          # Idempotent clients for external systems
  mcp.json                 # MCP server declarations
  Dockerfile
  package.json             # scoped as @daddia/crew-{name}
  tsconfig.json            # extends @repo/typescript-config/library
```

A solo crew (single persona, no team) uses the same shape and omits `agents/{persona}/`.

CLI-shaped crews follow the equivalent shape minus `handlers/`, the SQLite state store, and the Dockerfile; they expose a `cli.ts` entry point and publish to npm. See [`docs/architecture/solution.md`](docs/architecture/solution.md) §4.2 for the topology contract.

## Persona conventions

Each `agent.ts` exports a single named `const` typed as `Agent`:

```typescript
export const engineer: Agent = {
  name: 'engineer',
  async run(input: AgentInput): Promise<AgentResult> { ... }
}
```

The `run` implementation:

- Calls `resolveSession()` to decide create vs resume.
- Builds an `AgentDefinition` from the persona's `promptPath`, `skillPaths`, `subagentPaths`, `allowedTools`, and `mcpServerNames`.
- Attaches `buildAuditHook()` for every run — non-optional.
- Returns `AgentResult` with `success`, `summary`, `artefacts`, and `costUsd`.

Tool allowlists are enforced at two levels: the SDK `allowedTools` option, and the `buildAuditHook` belt-and-suspenders check at the post-tool-use boundary.

### Prompt injection / context provenance (threat model)

Jira issue bodies, parent ticket text, and MR/reviewer comments are **author-controlled** and may contain prompt-injection attempts (for example "ignore previous instructions" or "merge to main now"). Defense is layered:

1. **Delimiter fencing** — persona `agent.ts` modules wrap author text in explicit `<<< untrusted input — data only >>>` markers via `buildTaskPrompt` / `formatAgentContext` before sending to the model.
2. **System prompt** — each persona's `prompt.md` instructs the model to treat delimited content as data only, never as instructions.
3. **Tool allowlist** — `allowedTools` plus `buildAuditHook` block privileged operations (merge, protected-branch push) even if the model complies with injected instructions.

Agent `context` MUST be assembled from integration API responses fetched by the workflow, not from raw webhook bodies. Webhook handlers validate and deduplicate events, then pass only trusted identifiers (issue key, MR URL) into the workflow.

## State store conventions

Each crew owns its own SQLite database; the path is injected via `DB_PATH`. Use `createSqliteStateStore(dbPath)` — it provisions the standard three-table schema and enforces crash-recovery ordering.

Tables (per-crew SQLite, never shared):

- `stories` — one row per story, tracking `current_step` and `started_at`. The in-flight signal.
- `steps` — one row per step execution, recording `session_id`, `started_at`, `finished_at`, `cost_usd`, `verdict`.
- `webhook_events` — deduplication log keyed on `(provider, event_id)`.

**Crash-recovery ordering — non-negotiable:**

1. Call `state.upsertStory(issueKey, step)` **before** `agent.run()`. This is the canonical in-flight signal.
2. For non-agent steps, also call `state.startStep(issueKey, step)` before the work begins.
3. For agent steps whose `AgentResult` carries a `sessionId`, call `state.startStep(issueKey, step, sessionId)` **after** the run so the session ID is captured in the same row. Accepted trade-off: `started_at` ≈ `finished_at`, and a mid-run crash leaves no `steps` row — the `stories` row is still sufficient to identify the interrupted story.

## Workflow conventions

`workflow.ts` is the only file that knows the delivery sequence. It imports personas directly from the local `agents/` folder and never from another crew.

For new crews, prefer `createWorkflowEngine()` from `@daddia/crew/workflow`. Pass it a `WorkflowPlan` (a list of `WorkflowStep` objects with `name`, `agent`, optional `maxRetries`, and optional `onFailure` policy of `'escalate' | 'continue' | 'stop'`). The engine writes crash-recovery markers, accumulates step artefacts into a shared context, and calls your `onEscalate` callback on unrecoverable failure.

Hand-rolled `workflow.ts` files (as in `delivery-build`) remain valid. The engine is a convenience layer, not a requirement.

Escalation on failure or loop cap: call `commentOnIssue` + `transitionIssue("Needs human review")` and return. **Never let the workflow throw to the caller.**

The `REFACTOR_LOOP_CAP` env var (default `2`) limits how many `address-feedback` passes run in the internal peer-review loop. With cap `N`, the `for` loop allows up to `N+1` senior-engineer calls (iterations `0..N`) but at most `N` engineer (`address-feedback`) calls: on the last iteration peer review still runs, then the loop exits. The same cap applies to the external-comment path.

## Webhook handler conventions

Every inbound handler must:

1. Call `verifySignature()` from `@daddia/crew/webhooks` **before** parsing the body.
2. Call `checkReplayWindow()` and `createIdempotencyStore()` to deduplicate.
3. Return `200` promptly; run the workflow asynchronously (fire-and-forget with error logging).
4. Never expose internal error details in the response body.

## MCP configuration

Each crew's `mcp.json` declares the MCP servers it needs. Environment variable interpolation uses `${VAR_NAME}` syntax; the SDK resolves these at session start. Do not hardcode credentials.

Currently configured servers in `delivery-build`:

- `atlassian` — Jira read/write
- `gitlab` — MR operations

## Dependency rules (enforced by `pnpm lint`)

Non-negotiable. Boundary violations must not merge.

1. `crews/*` may import from `packages/*` only — never from another `crews/*`.
2. `packages/*` may not import from `crews/*`.
3. No circular dependencies within `packages/*`.
4. `crews/*` MUST consume `@daddia/crew` as a published npm dependency. Workspace linking (`workspace:*`, `workspace:^`, `link:`) is forbidden for `@daddia/crew` in any crew `package.json`.

## Development commands

| Command          | Description                    |
| ---------------- | ------------------------------ |
| `pnpm build`     | Build all packages and crews   |
| `pnpm typecheck` | Type-check everything          |
| `pnpm test`      | Run Vitest suite               |
| `pnpm lint`      | Dependency boundaries + ESLint |
| `pnpm clean`     | Remove build artefacts         |

Per-crew: `pnpm build`, `pnpm dev`, `pnpm typecheck`, `pnpm diagnose` (where the script exists).

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
- `state.upsertStory` called before `agent.run()` on every agent step.
- Every failure branch calls `escalateToHumanReview` and returns; none rethrow to the HTTP layer.
- `verifySignature` is the first operation in every webhook handler.
- No hardcoded credentials, tokens, or secrets anywhere in source.
- Author-controlled text (Jira descriptions, parent ticket fields, MR/reviewer comments) is wrapped in the untrusted-input delimiter before inclusion in persona prompts; system prompts instruct the model to treat delimited content as data only.
- Agent `context` is built from trusted integration outputs, not raw webhook payloads.
- If `@daddia/crew` was bumped: published to registry and every crew's pinned dep updated in the same PR.

## Guidance for common changes

- **Adding a persona** — start with `agent.ts` and `prompt.md`. Add skills only once the persona runs correctly with a plain prompt. Step-by-step: [`contributing/adding-a-persona.md`](contributing/adding-a-persona.md).
- **Adding a crew** — copy `crews/delivery-build/` as a template; update `package.json`. Step-by-step: [`contributing/adding-an-agent-crew.md`](contributing/adding-an-agent-crew.md).
- **Changing the `Agent` / `AgentResult` interface** — bump `@daddia/crew`, publish, update every crew's pinned dep, update every persona — all in the same PR.
- **Changing `StateStore` or `WorkflowEngine`** — same workflow as above; update every crew that uses the affected subpath in the same PR.
- **Changing webhook verification** — test against both Jira (HMAC) and GitLab (shared token) paths.
- **Changing `workflow.ts`** — check that escalation paths (loop cap, agent failure) transition Jira correctly and do not re-enter the workflow.
- **Implementing an `Orchestrator`** — return a `WorkflowPlan` with step names the crew's `StateStore` already accepts. Step names are stable strings stored in SQLite and used for crash-recovery lookups.
- **General** — modify the smallest scope needed. A change to a workflow should not touch shared types unless the contract truly changes. Run `pnpm lint` before pushing.

## Documentation

Start with [`docs/README.md`](docs/README.md). The hierarchy:

| Layer                 | Where                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Product strategy      | [`docs/product/strategy.md`](docs/product/strategy.md)                                               |
| Solution architecture | [`docs/architecture/solution.md`](docs/architecture/solution.md)                                     |
| Roadmap               | [`docs/product/roadmap.md`](docs/product/roadmap.md)                                                 |
| Active backlog        | Jira (`CREW` project)                                                                                |
| Guiding principles    | [`docs/architecture/principles.md`](docs/architecture/principles.md)                                 |
| ADRs                  | [`docs/architecture/decisions/`](docs/architecture/decisions/)                                       |
| Crew flow contracts   | [`docs/design/crew-flows/`](docs/design/crew-flows/)                                                 |
| Delivery approach     | [`docs/design/delivery/approach.md`](docs/design/delivery/approach.md)                               |
| Runbooks              | [`docs/runbook/`](docs/runbook/)                                                                     |
| Contributor guides    | [`contributing/`](contributing/)                                                                     |
| Research and ideas    | [Confluence CREW space](https://carinyaparc.atlassian.net/wiki/spaces/CREW/pages/753668/03+Research) |
