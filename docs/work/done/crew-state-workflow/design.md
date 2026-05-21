---
type: Design
scope: work-package
mode: as-built
work_package: crew-state-workflow
epic: CREW-68
version: '0.1'
owner: daddia
status: Complete
last_updated: 2026-05-21
related:
  - AGENTS.md
  - docs/product/backlog.md
  - architecture/solution.md
  - packages/crew/CHANGELOG.md
  - docs/work/done/crew-package/design.md
  - docs/work/done/crew-config/design.md
---

# Design -- `@daddia/crew` as control plane: state, workflow, orchestration (CREW-68)

As-built design for the `crew-state-workflow` work package, recording PR #12
after merge. This package adds three lightweight concepts to `@daddia/crew`
that elevate it from a collection of helper types into a **control plane** for
autonomous crew execution.

There is no parent `solution.md` for this repository. Cross-cutting policies
are authoritative in [`AGENTS.md`](../../../AGENTS.md).

---

## 1. The design thesis

### 1.1 The problem with v1 patterns

The original `crews/delivery-build` hand-rolled every piece of execution
infrastructure:

- A bespoke SQLite layer (`state.ts`) with ~150 lines of schema definition,
  WAL pragmas, and prepared statement management duplicated across every crew.
- A hand-written `workflow.ts` run loop that repeated the same upsert-before-run /
  startStep-after-run ordering convention — relying on developers knowing and
  following it rather than it being enforced by the framework.
- No shared language for "what can go wrong in a step" — each crew invented its
  own escalation and retry patterns.

v1 (crew-v1) proved these patterns were correct, but it prescribed them so
tightly that moving them into the shared runtime felt over-engineered for a
single crew. With delivery-build complete and additional crews imminent, the
cost-benefit reverses.

### 1.2 The proposed design: unified framework

> **The core idea: `@daddia/crew` becomes the control plane by adding three
> lightweight concepts — a `WorkflowPlan` type, a `WorkflowEngine` that
> executes any plan, and an `Orchestrator` interface that produces plans
> dynamically.**

The three concepts are designed to be adopted in stages:

| Concept                                 | What it is                                                                                            | Adoption                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `StateStore` + `createSqliteStateStore` | Interface and SQLite implementation for crash-safe story and step tracking                            | Drop-in replacement for any crew's hand-rolled state layer                          |
| `WorkflowEngine` + `WorkflowPlan`       | Execution engine: reads a plan, calls each step's agent, writes state, handles retries and escalation | Optional — existing hand-rolled `workflow.ts` files remain valid                    |
| `Orchestrator`                          | Interface: takes a request + agent registry, returns a `WorkflowPlan`                                 | Type contract only; deterministic or Claude-assisted implementations are crew-owned |

Critically, the framework is **not prescriptive about adoption pace**. The
`WorkflowEngine` is a convenience layer, not a mandate. A crew author can use
`createSqliteStateStore()` without using `createWorkflowEngine()`, and can use
`createWorkflowEngine()` without implementing an `Orchestrator`. Each concept
stands alone.

### 1.3 What's not in scope

- Migrating `crews/delivery-build` to use the new subpaths — that is F-06 in
  `docs/product/backlog.md`. Delivery-build's existing patterns are correct
  and proven; migration is a cleanup task, not a correctness requirement.
- Dynamic `Orchestrator` implementations — the interface is the type contract.
  First implementations will be deterministic plans; Claude-assisted planning
  is a later exercise once multiple crews exist.
- Durable cross-crew pipelines — F-05 in `docs/product/backlog.md`. The
  `Orchestrator` interface is the foundation layer for F-05; the runtime
  machinery (suspend/resume, fan-out) remains Future.

---

## 2. Scope

### 2.1 In scope

| Capability                                                                                                 | Subpath / location               |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `StateStore` interface, `StoryRow`, `StepRow`, `StepResult` types                                          | `@daddia/crew/state`             |
| `createSqliteStateStore(dbPath)` — SQLite implementation with WAL, three-table schema, prepared statements | `@daddia/crew/state`             |
| `WorkflowPlan`, `WorkflowStep`, `FailurePolicy` types                                                      | `@daddia/crew/workflow`          |
| `WorkflowEngine`, `WorkflowEngineOptions` types                                                            | `@daddia/crew/workflow`          |
| `createWorkflowEngine(options)` — executes a plan, writes state, calls `onEscalate`                        | `@daddia/crew/workflow`          |
| `Orchestrator`, `OrchestratorRequest`, `AgentRegistry` types                                               | `@daddia/crew` main entry        |
| `orchestrator?: Orchestrator` field on `AgentCrew` interface                                               | `@daddia/crew` main entry        |
| `toSDKHookCallback`, `ToolUseEvent`, `PostToolUseHandler`                                                  | `@daddia/crew` main entry        |
| Vitest resolve aliases for self-import in `packages/crew` tests                                            | `packages/crew/vitest.config.ts` |

### 2.2 Out of scope

- Migrating any existing crew to the new subpaths.
- `Orchestrator` runtime implementations.
- Changes to `@daddia/crew/webhooks` or `@daddia/crew/config`.
- Any new crew-level code.

---

## 3. Architecture fit

This work package adds two subpath exports parallel to the existing
`./webhooks` and `./config` subpaths. The same crew-ownership rule applies:

| Concern                                          | Where it lives                              | Principle                          |
| ------------------------------------------------ | ------------------------------------------- | ---------------------------------- |
| `StateStore` interface and SQLite implementation | `@daddia/crew/state`                        | Shared runtime owns mechanism      |
| Each crew's database path and `Step` type        | `crews/{name}/src/state.ts`                 | Each crew owns its schema and init |
| `WorkflowPlan` assembly                          | Crew's `workflow.ts` or `Orchestrator` impl | Each crew owns intent (the plan)   |
| `WorkflowEngine` execution                       | `@daddia/crew/workflow`                     | Shared runtime owns execution      |
| Escalation callback                              | Crew-provided `onEscalate`                  | Each crew owns its escalation path |

The mental model for the split:

> **`@daddia/crew/state` is how state is persisted; the crew's `state.ts` is
> what step names exist.**
>
> **`@daddia/crew/workflow` is how a plan is executed; the crew's
> `workflow.ts` (or `Orchestrator`) is what the plan is.**

This mirrors the same mechanism/intent split that `@daddia/crew/config`
established: shared package owns the loader; each crew owns the schema.

---

## 4. Files and components

### 4.1 New files

```text
packages/crew/src/
  state/
    store.ts          StateStore interface, StoryRow, StepRow, StepResult
    sqlite.ts         createSqliteStateStore(dbPath): WAL mode, three tables,
                      all operations as prepared statements
    index.ts          @daddia/crew/state barrel export
  workflow/
    plan.ts           WorkflowPlan, WorkflowStep, FailurePolicy
    engine.ts         WorkflowEngineOptions, WorkflowEngine, createWorkflowEngine()
    index.ts          @daddia/crew/workflow barrel export
  orchestrator.ts     Orchestrator, OrchestratorRequest, AgentRegistry
```

### 4.2 Modified files

```text
packages/crew/
  package.json        +./state and +./workflow exports entries
  src/index.ts        +Orchestrator, OrchestratorRequest, AgentRegistry exports
                      +toSDKHookCallback, ToolUseEvent, PostToolUseHandler exports
  src/unit.ts         +orchestrator?: Orchestrator on AgentCrew interface
  vitest.config.ts    +resolve.alias for all five @daddia/crew subpaths → src
```

---

## 5. Key design decisions

### 5.1 `StateStore` as an interface, not a class

The `StateStore` is an `interface` rather than a class or factory that crews
inherit from. This means:

- Crews that already have a working hand-rolled state layer are not broken.
- The `createSqliteStateStore` implementation is the default; nothing prevents
  a future in-memory implementation for testing.
- The `WorkflowEngine` depends only on the interface, not the SQLite
  implementation — testable without a database.

### 5.2 `WorkflowEngine` is opt-in, not the only path

Existing hand-rolled `workflow.ts` files (delivery-build) remain valid and
correct. The `WorkflowEngine` is a structured alternative for new crews, not a
migration target. The engine's `run(plan, context?)` method is intentionally
minimal: it calls each step's agent, writes crash markers, accumulates
artefacts into context, and routes failures via the `onFailure` policy. It does
not own escalation logic — that belongs to the crew via `onEscalate`.

### 5.3 `Orchestrator` is a type contract, not an implementation

The `Orchestrator` interface establishes the type surface for dynamic workflow
planning: `plan(request, registry) → WorkflowPlan`. It does not ship an
implementation. First use cases will be deterministic (the method returns a
pre-defined plan based on the request). Claude-assisted implementations —
where the orchestrator reasons over the registry to assemble a plan — require
multiple crews to be in production first.

The `AgentRegistry` type (`Readonly<Record<string, Agent>>`) is the named
lookup that an `Orchestrator` receives. It maps persona names to agent
instances, allowing the orchestrator to reference agents by name in the
returned plan.

### 5.4 Vitest resolve aliases for self-import

`packages/crew/tests/webhooks.test.ts` imports `@daddia/crew` from within the
package itself. Vite/Vitest resolves this via the `exports` map which points to
`./dist/index.js` — a path that doesn't exist without a prior build. Adding
`resolve.alias` entries in `packages/crew/vitest.config.ts` maps all five
subpaths directly to their TypeScript source files. This makes tests runnable
without a build step and is the standard pattern for monorepo self-imports.

---

## 6. State store schema

The `createSqliteStateStore` implementation provisions three tables:

```sql
CREATE TABLE IF NOT EXISTS stories (
  issue_key    TEXT    PRIMARY KEY,
  current_step TEXT    NOT NULL,
  started_at   INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE TABLE IF NOT EXISTS steps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_key    TEXT    NOT NULL,
  step         TEXT    NOT NULL,
  session_id   TEXT,
  started_at   INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
  finished_at  INTEGER,
  cost_usd     REAL,
  verdict      TEXT
);

CREATE TABLE IF NOT EXISTS webhook_events (
  provider     TEXT    NOT NULL,
  event_id     TEXT    NOT NULL,
  received_at  INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
  PRIMARY KEY (provider, event_id)
);
```

WAL mode is set on connection open. All reads and writes use prepared
statements bound at store creation. The store exposes `ping()` and `close()`
for lifecycle management.

---

## 7. WorkflowEngine execution model

For each `WorkflowStep` in the plan:

1. `store.upsertStory(issueKey, step.name)` — crash-recovery anchor, written
   **before** the agent run.
2. `step.agent.run({ issueKey, context })` — accumulated context passed in,
   step artefacts merged out.
3. `store.startStep(issueKey, step.name, sessionId)` + `store.finishStep(...)` —
   written **after** the run with session ID and outcome.
4. On failure: retry up to `step.maxRetries` times (default 0), then apply
   `step.onFailure` policy:
   - `'escalate'` (default) — call `onEscalate(issueKey, step.name, reason)`
     and stop.
   - `'continue'` — log the failure and move to the next step.
   - `'stop'` — stop without escalating.

The `onEscalate` callback is crew-provided and should call
`commentOnIssue` + `transitionIssue("Needs human review")` following the
standard crew escalation pattern.

---

## 8. Acceptance

- All 51 `packages/crew` tests pass, including `tests/webhooks.test.ts` which
  imports `@daddia/crew` without a prior build step.
- All quality CI checks pass: format, lint, typecheck, dependencies, tests.
- `@daddia/crew/state` and `@daddia/crew/workflow` are resolvable as package
  exports (verified at publish time per `docs/runbook/publish.md`).
