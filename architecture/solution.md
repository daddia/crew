---
type: Solution
scope: product
stage: full
version: '1.0'
owner: daddia
status: Draft
last_updated: 2026-05-06
related:
  - docs/product/product.md
  - docs/product/backlog.md
  - docs/crew-flows/delivery-build.md
  - docs/crew-flows/delivery-qa.md
  - docs/crew-flows/delivery-review.md
  - AGENTS.md
---

# Solution -- Crew

Architecture for the Crew platform across the **Now / Next / Later / Future**
phases in [`product.md`](../product/product.md). The thesis: a shared runtime
and a growing catalogue of deployable agent crews, each independently operable
and composable into pipelines. The software delivery pipeline (build → QA →
review) is the first vertical on the platform; it demonstrates the runtime
contract, not the limit of the architecture.

Sprint-level designs live in `docs/work/{wp}/design.md`. Current-state
conventions are authoritative in `AGENTS.md`.

## 1. Context and scope

### 1.1 System context

The platform thesis: any work source feeds a growing catalogue of deployable
agent crews; each crew writes to any system of record; the shared runtime
provides the guarantees that make every crew safe to run unattended. Delivery
is the first vertical on the platform, not the definition of the platform.

```text
                        [Operator / Reviewer]
                                 |
         ┌───────────────────────┴──────────────────────────┐
         │                  Crew Platform                    │
         │                                                   │
Work     │  ── Delivery vertical (Now) ──────────────────    │  Systems of
sources  │    delivery-build ──► delivery-qa                │  record
         │                     ──► delivery-review  ────────┼─► VCS host
· Jira ─►│                                                   │    (GitLab / GitHub
· CI    ─►│  ── Code review vertical (Next) ───────────────  │    MRs, pipelines)
· cron  ─►│    code-reviewer  (CLI, published to npm) ──────┼─► PR comments
· ...   ─►│                                                   │
         │  ── Roadmap verticals ─────────────────────────   │  · Jira (status)
         │    product-crew      [Later]                      │  · Slack / email
         │    architecture-crew [Later]                      │  · ...
         │    discovery-crew    [Later]                      │
         │    feedback-crew     [Later]                      │
         │                                                   │
         │  ── Shared foundation ─────────────────────────   │
         │    @daddia/crew runtime                           │
         │    Foundation model API  (Anthropic)              │
         │    MCP server fabric     (Atlassian, GitLab, ...) │
         │    Audit + Observability (per-crew SQLite / OTel) │
         └───────────────────────────────────────────────────┘
```

In the **Future** phase a Cross-Crew Orchestrator sits above the catalogue and
treats each crew as a composable, durable step in a longer pipeline:

```text
[Trigger]  ──►  [Orchestrator]  ──►  [Crew A]  ──►  [Crew B]  ──►  ...
                      │                   ^              ^
                      └── suspend / resume / fan-out ────┘
```

### 1.2 System boundary

**Crew owns:**

- The runtime contract: `Agent`, `AgentCrew`, `AgentInput`, `AgentResult`, and
  the `@daddia/crew` library that implements it.
- The two first-class deployment topologies a crew can adopt:
  - **Server-shaped** — a long-lived Hono service that owns SQLite state,
    polls a work source, and receives inbound webhooks. Used for stateful,
    multi-step workflows (all three delivery crews).
  - **CLI-shaped** — an ephemeral package published to npm and invoked in CI.
    Runs to completion, writes results to the system of record, exits. No
    persistent state. Used for stateless one-shots (code-reviewer, next).
- Inbound webhook security primitives (`@daddia/crew/webhooks`), typed config
  (`@daddia/crew/config`), and the bounded-loop / audit-hook / escalation
  guarantees that apply uniformly across both topologies.
- The future cross-crew orchestration layer (Future phase).

**Crew does not own:**

- The foundation model or the agent SDK — Crew is a runtime layer on top of
  the Claude Agent SDK, not a replacement for it.
- External domain models (Jira issue structure, GitLab MR schema) — consumed
  via thin idempotent integration clients; each crew owns its own clients.
- Tool implementations exposed via MCP — Crew configures servers; it does not
  ship them.
- The operator's workflow definition — each crew owns its own `workflow.ts`,
  personas, prompts, and definition of done.

### 1.3 Upstream and downstream systems

- **Upstream — Work source (Jira today; pluggable).** Provides the work queue
  and lifecycle states for server-shaped crews. CLI-shaped crews receive
  context from CI env vars or invocation arguments instead. State transitions
  are idempotent in both topologies.
- **Upstream — Foundation model + MCP servers.** Provide reasoning and tool
  surfaces. Cost and latency budgets are enforced at the crew runtime.
- **Downstream — System of record.** VCS host (branches, MRs, pipeline status)
  for delivery crews; PR comment threads for the code-reviewer; other surfaces
  for future verticals.
- **Downstream — Audit + observability sinks.** Structured logs, OTel traces
  (planned), cost-per-run metrics, and the per-step audit trail.
- **Future bidirectional — Cross-crew orchestrator.** Triggers crews via the
  same event surface they accept today; consumes `ready-for-*` handoff events
  to advance long-running pipelines.

## 2. Quality goals and constraints

### 2.1 Quality goals (top 5, ordered)

1. **Auditability.** Every crew action is reconstructible from the per-crew
   audit trail without consulting the operator. The audit trail is the
   product (see [`product.md`](../product/product.md) §8).
2. **Bounded operation.** Every loop has a cap, every external call a timeout,
   every run a cost ceiling. Unbounded automation is unbounded spend.
3. **Autonomy with clean escalation.** When a crew cannot proceed with
   confidence it escalates to a human with full context — silent failure is
   worse than visible escalation. The escalation path is a feature.
4. **Reproducible deployability.** A new crew goes from blank slate to
   deployed service by writing workflow + personas + prompts only.
   "Time to first crew" is the leverage metric.
5. **Composability.** Crews are independent at the unit and composable at the
   orchestration layer. A crew that runs correctly in isolation must continue
   to run correctly when a pipeline is added around it. Independence is the
   precondition; composition is the value. The delivery pipeline (three
   independent crews coordinated by state transitions) is the first proof of
   this property.

### 2.2 Constraints

- **Technical.** One deployment unit per crew, in one of the topologies
  permitted by §3 principle 6: a long-lived container (server-shaped) or a
  published npm package invoked in CI (CLI-shaped). No multi-region or
  multi-tenant inside a single deployment unit. Node.js ≥ 24, pnpm monorepo,
  TypeScript-only.
- **Regulatory.** A single crew run touches a single organisation and a single
  repository — never both at once, never one crossing into the other. (The
  deployed crew itself is not single-tenant: a CLI-shaped crew published to
  npm is invoked independently in each consumer's CI; a server-shaped crew may
  be operated for any tenant by running another instance.) No PII handling
  beyond what the work source already exposes.
- **Organisational.** Solo-operated product. Architecture must be legible
  enough for a future contributor — and for AI agents that will themselves
  modify Crew — to extend without an oral handoff.

## 3. Solution strategy

| #   | Principle                                                                                                                                                                                                                                                                                                                                                                                                              | Trade-off                                                                                                                                            | Quality goal                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | **Independently deployable units, not modules.** Each crew is its own process, its own state, its own entry point. Coupling between crews is event-driven, never in-process.                                                                                                                                                                                                                                           | Duplicated boilerplate per crew, paid back by lifting any crew into its own repo or org without rewiring dependencies.                               | Composability                   |
| 2   | **Shared runtime, crew-owned policy.** `@daddia/crew` owns mechanism (session, audit hook, bounded-loop guard, webhook verification, typed config, state store implementation, workflow execution engine). Each crew owns intent (workflow plan, personas, prompts, definition of done).                                                                                                                                                                                           | A sharper API surface on the shared package; rewarded by every new crew picking up runtime fixes for free.                                           | Reproducible deployability      |
| 3   | **Bounded loops and audit hooks are non-optional.** `boundedIterGuard()` wraps every refactor / CI-fix / remediation loop; `buildAuditHook()` wraps every persona run. Not opt-in — they are how a crew is built, in every vertical.                                                                                                                                                                                   | Less freedom for an "experimental" crew to skip controls; rewarded by every crew in the catalogue being safe to run unattended.                      | Auditability, Bounded operation |
| 4   | **Idempotent fire-and-forget now; durable orchestration later.** Handlers verify, deduplicate, return 200, run the workflow async. The Future-phase orchestrator sits above crews — it doesn't change how they receive events.                                                                                                                                                                                         | A crashed partial run is recovered by a per-crew startup scan, not an external scheduler; acceptable until the second crew ships.                    | Autonomy with clean escalation  |
| 5   | **One process per tenant, one tenant per process.** Each instance is single-tenant by construction; the operational unit is the container (server) or the process invocation (CLI). Fleet management lives above the crew, not inside it.                                                                                                                                                                              | Horizontal scale = more containers, not more threads; rewarded by trivial blast-radius isolation.                                                    | Composability                   |
| 6   | **Runtime shape pluralism.** The `Agent` / `AgentCrew` contract is shape-agnostic. A crew deploys as a **server** (long-lived, stateful, polls + receives webhooks) for multi-step workflows, a **CLI package** (ephemeral, published to npm, invoked in CI) for stateless one-shots, or a **scheduled batch** (cron-triggered) for periodic work. Same audit, bounded-loop, and escalation guarantees in every shape. | The shared runtime API must remain topology-neutral; server-only helpers (`verifySignature`, crash recovery) cannot be imported by CLI-shaped crews. | Reproducible deployability      |

## 4. Building block view

### 4.1 Platform tiers

```text
  ── Composition layer (Future) ────────────────────────────────────────────
     Cross-Crew Orchestrator — durable pipelines, fan-out, suspend/resume

  ── Crew catalogue ────────────────────────────────────────────────────────
     Delivery vertical (Now)          Code review vertical (Next)
       delivery-build  [server]          code-reviewer  [CLI, npm]
       delivery-qa     [server]
       delivery-review [server]        Roadmap verticals (Later/Future)
                                         product-crew      [TBD]
                                         architecture-crew [TBD]
                                         discovery-crew    [TBD]
                                         feedback-crew     [TBD]

  ── Shared runtime ────────────────────────────────────────────────────────
     @daddia/crew  (main)      Agent, AgentCrew, AgentInput, AgentResult
                               resolveSession, buildAuditHook, boundedIterGuard
                               readPromptFile, readSkillsDir, readSubagentsDir
                               Orchestrator, AgentRegistry
     @daddia/crew/webhooks     verifySignature, checkReplayWindow, idempotency
     @daddia/crew/config       loadEnv, loadYaml, Secret brand, redact
     @daddia/crew/state        StateStore interface, createSqliteStateStore
     @daddia/crew/workflow     WorkflowEngine, WorkflowPlan, FailurePolicy
     @daddia/crew/events       [Future] typed cross-crew event contracts

  ── Foundation ────────────────────────────────────────────────────────────
     Claude Agent SDK          session create / resume, tool execution
     MCP server fabric         Atlassian, GitLab, and crew-specific servers
     Foundation model API      Anthropic
     Audit / Observability     per-crew SQLite today; OTel sink (planned)
```

### 4.2 Crew layouts — two first-class topologies

**Server-shaped** (stateful, long-lived — all delivery crews):

```text
crews/{name}/
  src/
    index.ts          Hono server; loadConfig() at boot; mounts handlers
    config.ts         Typed schema; only file that reads process.env
    workflow.ts       Sequence; imports only this crew's personas
    state.ts          SQLite state store — initialises createSqliteStateStore(DB_PATH)
    poller.ts         Work-source polling (primary trigger)
    observability.ts  Structured logger + OTLP bootstrap (planned)
    agents/{persona}/ agent.ts, prompt.md, .claude/{skills,agents}/
    handlers/         One file per inbound event source (verified, idempotent)
    integrations/     Thin idempotent clients for external systems
  mcp.json            MCP server declarations
  Dockerfile          Two-stage build; runtime installs @daddia/crew from npm
  package.json        @daddia/crew-{name}; depends on @daddia/crew
```

**CLI-shaped** (ephemeral, published to npm — code-reviewer and beyond):

```text
crews/{name}/
  src/
    cli.ts            Entry point; reads context from argv / CI env vars
    config.ts         Typed schema; only file that reads process.env
    workflow.ts       Sequence; runs to completion and exits
    agents/{persona}/ agent.ts, prompt.md, .claude/{skills,agents}/
    integrations/     Thin idempotent clients for external systems
  mcp.json            MCP server declarations
  package.json        @daddia/crew-{name}; publishable; no Dockerfile
```

No persistent state in a CLI-shaped crew; results are written to the system of
record before exit. Server-only helpers (`@daddia/crew/webhooks`, crash
recovery) must not be imported by CLI-shaped crews — this is enforced at the
package level.

The dependency rule (`dependency-cruiser`): `crews/* → packages/*` only;
`packages/*` never imports from `crews/*`; no circular deps in `packages/*`.
This boundary is what makes lifting any crew into its own repo a mechanical
operation.

## 5. Runtime view

### 5.1 How crews compose (abstract pattern)

All crew coordination — whether within the delivery pipeline today or across
future cross-vertical pipelines — follows the same abstract pattern. No crew
calls another crew's code path; composition is entirely event-driven.

```text
  Work source
      │
      ▼
  [Crew A]  ─── workflow runs ───► system of record write
      │                            (state transition + handoff event)
      │  ready-for-next
      ▼
  [Crew B]  ─── workflow runs ───► system of record write
      │                            (state transition + handoff event)
      │  ready-for-next
      ▼
  [Crew C]  ─── ...
```

Today: handoff events are state transitions on the work source (Jira) plus a
structured log line; each consuming crew polls the work source as its fallback
trigger. In the Future phase: the orchestrator subscribes to `ready-for-*`
events and triggers downstream crews durably, with suspend / resume across
process restarts.

### 5.2 Delivery pipeline (server-shaped, three crews — one instance of §5.1)

```text
[delivery-build]                   [delivery-qa]                  [delivery-review]
  poll Jira (To Do)                  poll Jira (In QA)               poll Jira (In Review)
       │                                  │                                │
       ├─► assess clarification           ├─► deploy MR to QA env          ├─► tech-lead review
       │   (HITL pause if unclear)        ├─► run automated suite          │   (architecture + AC)
       ├─► implement on branch            ├─► run exploratory pass         ├─► PM stakeholder review
       ├─► peer review (bounded loop)     ├─► defects → bounded            │   (HITL, blocking)
       ├─► open MR                        │   remediation loop ─────► back │
       ├─► CI monitor (bounded loop)      │   to delivery-build            ├─► merge to main
       └─► transition: In QA              └─► transition: In Review        └─► transition: Done
            emit ready-for-qa                  emit ready-for-review
```

### 5.3 Escalation (any cap exceeded, any unhandled error)

```text
loop cap reached                        agent.run() throws
        │                                       │
        └────────────► escalateToHumanReview ◄──┘
                              │
                              ├─► commentOnIssue   (full context, unresolved items)
                              ├─► transitionIssue  ("Needs human review")
                              └─► return / exit     (workflow does not throw to the caller)
```

Escalation is the only exit path other than success, in every topology. Server
crews transition Jira and return; CLI crews post a comment and exit non-zero.

### 5.4 CLI-shaped lifecycle (ephemeral, stateless)

```text
CI trigger (e.g. MR pipeline) or cron
   │
   ├─► read context from argv / CI env vars
   ├─► loadConfig()          fail-fast on misconfig
   ├─► agent.run()           full audit hook + bounded-loop guards apply
   ├─► write results to system of record   (PR comment, status check, ...)
   └─► exit 0 (success) or exit 1 (escalated / failed)
```

No persistent state; no startup scan; no webhook listener. Results must be
written to the system of record before exit — the process has no memory between
invocations. The same `Agent` / `AgentCrew` contract applies; only the entry
topology differs.

### 5.5 Server-shaped crash recovery (startup scan)

```text
process boot
   │
   ├─► loadConfig()           fail-fast on misconfig
   ├─► open SQLite store
   ├─► recoverInterruptedSteps:
   │     scan stories with no matching finished step
   │     resumeSession(sessionId) → restart workflow OR escalate
   ├─► start HTTP server      (handlers + healthz)
   └─► start poller           (only after recovery completes)
```

The invariant: no new story begins processing until interrupted runs have been
either resumed or escalated. The `stories` row written _before_ `agent.run()`
is the canonical in-flight signal.

## 6. Data model and ubiquitous language

### 6.1 State and audit

The audit trail is uniform across topologies — quality goal #1 cannot be
conditional on deployment shape. The _storage_ differs because a CLI-shaped
crew has no process between invocations.

| Concern                 | Server-shaped                                                               | CLI-shaped                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit + step records    | Per-crew SQLite (`stories`, `steps`, `webhook_events`) on a named volume.   | Remote audit sink via `@daddia/crew/audit` (planned, blocks code-reviewer ship). Same `step` schema, different transport.                                                                                |
| Dedup / idempotency     | `webhook_events` table; in-flight `stories` row prevents double-processing. | The system of record is the dedup store: before writing, the crew checks the SoR for its prior write at the same key (e.g. an existing AI-bot comment on the MR at the same SHA). No local state needed. |
| Crash recovery          | Startup scan of interrupted `stories` rows; resume or escalate (§5.5).      | None needed — CI retries the whole job on failure.                                                                                                                                                       |
| Cross-crew coordination | Event-driven through the work source; never via shared database.            | Same — and the audit sink is read-only for cross-crew consumers.                                                                                                                                         |

**Server-shaped tables** (per-crew SQLite, never shared):

| Table            | Purpose                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `stories`        | One row per story; `current_step` and `updated_at`. The in-flight signal.                     |
| `steps`          | One row per step execution; `session_id`, `started_at`, `finished_at`, `cost_usd`, `verdict`. |
| `webhook_events` | Deduplication log keyed on `(provider, event_id)`.                                            |

**CLI-shaped audit envelope** (sent to the remote sink at run completion):

```text
{ crew, runId, sha, target, persona, sessionId,
  startedAt, finishedAt, costUsd, verdict, tools[] }
```

No crew shares storage with another crew. The audit sink is append-only and
indexed by `(crew, runId)`; cross-crew consumers read by query, never by
direct database coupling.

### 6.2 Glossary

**Crew** — independently deployable agent service (one workflow, one team of personas, one deployment unit — a container for server-shaped crews, a published package for CLI-shaped crews). **Persona** — a named role (`engineer`, `senior-engineer`, `tech-lead`, `code-quality`) implementing the `Agent` interface. **Workflow** — deterministic sequence in `workflow.ts`; the only file that knows the sequence. **Run** — one workflow execution for one story, identified by `(crew, issueKey)`. **Step** — one persona invocation or external integration call within a run. **Escalation** — terminal "needs human" exit path; comment + status transition + structured log. **Bounded loop** — any iteration capped by an env-driven cap (`REFACTOR_LOOP_CAP`, `CI_RETRY_CAP`, `QA_DEFECT_LOOP_CAP`, ...). **Handoff event** — `ready-for-{stage}` signal emitted when a crew finishes its slice.

## 7. Cross-cutting concepts

| Concept                                     | Pattern                                                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit trail**                             | `buildAuditHook()` attached to every persona run; every tool call logged with cost and verdict. The audit trail is the product. Storage per topology — see §6.1.                                                                      |
| **Bounded operation**                       | `boundedIterGuard()` wraps every refactor / CI-fix / remediation loop; throws `IterationCapReached` on cap.                                                                                                                           |
| **Tool safety**                             | Two-layer allowlist: SDK `allowedTools` + `buildAuditHook` belt-and-suspenders.                                                                                                                                                       |
| **Idempotency**                             | Server crews: external writes key on `issueKey` or `(provider, event_id)`; `webhook_events` dedup. CLI crews: the system of record is the dedup store — check before write, keyed on the natural identity of the run (e.g. MR + SHA). |
| **Configuration**                           | One typed `Config` per crew; `process.env` only inside `config.ts` (lint-enforced); secrets branded and redacted from logs.                                                                                                           |
| **Webhook security** _(server-shaped only)_ | `verifySignature()` + `checkReplayWindow()` + dedup store, all from `@daddia/crew/webhooks`, before body parse. CLI crews have no inbound surface.                                                                                    |
| **Observability**                           | Structured logs today; OTel traces + cost-per-run metrics planned (CREW-55-001). One boot log answers "what config is this running with?"                                                                                             |
| **Crash recovery** _(server-shaped only)_   | Startup scan resumes interrupted SDK sessions or escalates; completes before HTTP server and poller start. CLI crews are retried by CI at the job level.                                                                              |
| **Project memory**                          | Personas seed project memory at run start; reduces repeated context cost across runs.                                                                                                                                                 |
| **Testing**                                 | Vitest unit + integration tests per package and per crew; one `pnpm test` runs everything.                                                                                                                                            |

## 8. Deployment and environments

One deployment unit per crew; the unit's shape follows the crew's topology.

**Server-shaped crews** deploy as containers on a managed runtime (Railway
today) with SQLite on a named volume; secrets are injected as service env vars.
Local: `pnpm dev` per crew or `docker compose up` for full-container smoke
(`docs/runbook/container.md`). One container per crew, end to end.

**CLI-shaped crews** publish to public npm via Changesets on merge to `main`;
consumers invoke the crew with `npx @daddia/crew-{name}` in their CI pipeline
(or pin the version in their job config). No persistent runtime; each invocation
opens a session, runs to completion, ships an audit envelope (§6.1) to the
configured sink, and exits. Local: `pnpm dev` runs the CLI against a fixture.

**Both topologies depend on `@daddia/crew` from the public npm registry** — the
runtime contract is identical. CI runs `pnpm lint && typecheck && test && build`
on every PR (GitHub Actions, planned in CREW-64).

Future-phase additions: a durable orchestration service subscribing to
`ready-for-*` events; a fleet manifest mapping tenants → crew instances; an
OTel collector for unified traces; a managed audit sink to replace per-tenant
sink configuration.

## 9. Architectural decisions (ADR log)

Architectural decisions are inferred from the current codebase and product
direction. Authoring them as MADR entries under `docs/architecture/decisions/`
is itself a graduation candidate (see §11).

| ID      | Decision                                                                                                                                                      | Status              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| ADR-001 | One process per crew; no shared process across crews                                                                                                          | _(Not yet written)_ |
| ADR-002 | Shared runtime via `@daddia/crew`; crews depend on the published package, not the workspace                                                                   | _(Not yet written)_ |
| ADR-003 | Polling as the primary trigger; webhooks as secondary (server-shaped)                                                                                         | _(Not yet written)_ |
| ADR-004 | Per-crew SQLite for server-shaped crews; remote audit sink for CLI-shaped crews; no shared database                                                           | _(Not yet written)_ |
| ADR-005 | Bounded loops and audit hooks are non-optional in the runtime API                                                                                             | _(Not yet written)_ |
| ADR-006 | Typed config in one file per crew; `process.env` lint-banned elsewhere                                                                                        | _(Not yet written)_ |
| ADR-007 | Fire-and-forget handoff events now; durable cross-crew orchestration deferred to Future phase                                                                 | _(Not yet written)_ |
| ADR-008 | Two first-class deployment topologies (server-shaped container, CLI-shaped npm package); scheduled-batch and others deferred until a concrete crew needs them | _(Not yet written)_ |

## 10. Risks, technical debt, and open questions

### 10.1 Risks

| ID  | Risk                                                                              | Likelihood | Impact | Mitigation                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Foundation model cost drift makes autonomous runs uneconomic                      | Medium     | High   | Per-run cost cap; cost-per-run reported per crew; alert on rising trend.                                                                                                                                      |
| R2  | Fire-and-forget event model loses a handoff between crews                         | Medium     | Medium | Polling fallback on every consuming crew until durable orchestrator ships.                                                                                                                                    |
| R3  | Shared runtime API churn breaks deployed crews silently                           | Low        | High   | Semver via Changesets; crews pin a minor; integration tests on every release.                                                                                                                                 |
| R4  | Single-container deployment becomes a bottleneck at server-shaped fleet scale     | Low        | Medium | Defer until second server-shaped crew is in production; revisit topology then.                                                                                                                                |
| R5  | Audit trail volume outpaces local SQLite                                          | Low        | Medium | Plan shipping audit events to an external sink in the Next phase.                                                                                                                                             |
| R6  | CLI-shaped crew loses run audit if invoked without a remote audit sink configured | Medium     | High   | Fail fast at CLI startup if `AUDIT_SINK_URL` (or equivalent) is unset; tested in `crews/{name}/tests/cli.boot.test.ts`. The audit trail is the product — running without it is not a permitted degraded mode. |
| R7  | CLI-shaped crew double-acts on the same target across two CI invocations          | Medium     | Medium | The system of record is the dedup store: the workflow checks for its prior write at the same key (e.g. existing AI-bot comment on the MR at the same SHA) before acting. Tested per crew.                     |

### 10.2 Technical debt

- **OTel tracing not yet wired.** Structured logs cover most needs; tracing
  closes when CREW-55-001 ships.
- **No GitHub Actions yet.** Local `pnpm lint` is the gate; CI lands in CREW-64.
- **Architectural decisions are implicit.** ADRs §9 should be authored as
  MADR entries; until then, this document is the canonical reference.

### 10.3 Open questions

1. **What is the remote audit sink implementation for CLI-shaped crews?**
   Candidates: managed Postgres, a hosted audit service (e.g. Logfire,
   Honeycomb-on-events), or structured logs scraped to a warehouse.
   Owner: daddia. **Blocks: code-reviewer (the first CLI-shaped crew) ship.**
   Required output is the `@daddia/crew/audit` API surface plus one
   reference-implementation transport.
2. **Where does the cross-crew orchestrator live?** A new top-level `crews/`
   service, a separate package, or a managed offering (e.g. Temporal,
   Inngest)? Owner: daddia. Blocks: nothing in Now/Next phases; required
   before Future phase.
3. **What is the second crew?** Identifying it is required to validate the
   "shared runtime, crew-owned policy" principle empirically. Owner: daddia.
   Blocks: graduation of any pattern under §11.
4. **How is multi-crew cost reported?** Per-crew is solved; portfolio-level
   roll-up is unowned. Owner: daddia. Blocks: portfolio-scope reporting.

## 11. Graduation candidates

Nothing graduates speculatively. Each row lifts only when the trigger fires.

**Crew-level patterns** (lift when the second crew needs the same thing):

| Pattern                                                      | Current home                                                       | Graduate to                                                                           | Trigger                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote audit sink                                            | `crews/delivery-build/src/state.ts` (SQLite-only today)            | `@daddia/crew/audit` (transport-agnostic API + at least one reference implementation) | **Code-reviewer (the first CLI-shaped crew) ships** — a CLI crew cannot hold SQLite locally, and the audit trail is the product. This is a Next-phase blocker, not Future. |
| Story-source polling loop                                    | `crews/delivery-build/src/poller.ts`                               | `@daddia/crew/triggers`                                                               | Second server-shaped crew adopts polling.                                                                                                                                  |
| Escalation helper                                            | `crews/delivery-build/src/workflow.ts` (`escalateToHumanReview`)   | `@daddia/crew/escalation`                                                             | Second crew copies the same shape.                                                                                                                                         |
| Server crash-recovery scan                                   | `crews/delivery-build/src/workflow.ts` (`recoverInterruptedSteps`) | `@daddia/crew/recovery`                                                               | Second server-shaped crew needs interrupted-run recovery.                                                                                                                  |
| Per-crew state schema (`stories`, `steps`, `webhook_events`) | `crews/delivery-build/src/state.ts`                                | `@daddia/crew/state`                                                                  | Second server-shaped crew duplicates the same three tables.                                                                                                                |
| MCP config conventions                                       | `crews/delivery-build/mcp.json`                                    | `@daddia/crew/mcp` (loader + validator)                                               | Second crew declares the same shape.                                                                                                                                       |
| ADRs                                                         | This document, §9                                                  | `docs/architecture/decisions/{id}.md` (MADR)                                          | Any decision in §9 is contested or revisited.                                                                                                                              |
| Cross-crew handoff event schema                              | Implicit in `ready-for-*` log lines                                | `@daddia/crew/events` (typed contracts)                                               | Cross-crew orchestrator design begins (Future phase).                                                                                                                      |

**Platform-level patterns** (lift when the platform itself warrants the abstraction):

| Pattern                    | Current home                                | Graduate to                                         | Trigger                                                                                                                                            |
| -------------------------- | ------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crew catalogue / discovery | Implicit in `crews/` directory listing      | `@daddia/crew/catalogue` (manifest + discovery API) | Five or more crews exist and a new crew needs to locate another crew's entry point or event schema programmatically.                               |
| Fleet manifest             | Manual deployment of one container per crew | `fleet.yaml` (crew type → instance count mapping)   | A tenant needs to run more than one instance of the same crew type simultaneously (e.g. two delivery-build instances for different Jira projects). |
