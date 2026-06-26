---
type: Solution Architecture
scope: product
stage: full
version: '2.2'
owner: daddia
status: Current
last_updated: 2026-06-26
related:
  - docs/product/strategy.md
---

# Solution Architecture -- Crew

Architecture for the Crew platform across the **Now / Next / Later / Future** phases in [`strategy.md`](../product/strategy.md). The thesis (per `strategy.md` §3, §8): a shared runtime hosts a growing **catalogue** of deployable crews; each crew is independently operable and composable into pipelines; the platform compounds value **above the model** through memory, evidence, evaluation, and orchestration that no single foundation-model call can match. The delivery vertical (build → QA → review) is the first proof of the runtime contract, not the limit of the architecture.

Three further constraints flow from the product narrative and shape this document:

1. **Compounding surface.** Memory, evidence, evaluation policy, model routing, and orchestration are first-class platform concerns — not afterthoughts. The Pro-tier managed control plane (planned, deferred to the Next / Later phases) is where these compound across runs and crews.
2. **Legible to agents.** Crew is extended by AI agents, including Crew itself. Building blocks, contracts, and conventions must be reasonable over by an agent, not only by a human — names are explicit, side effects are local, and module boundaries match the words an agent would search for.
3. **Agent SDK-agnostic.** Crew is a runtime and deployment layer on top of *an* agent SDK, not a specific one. The SDK in use today resolves sessions, executes tools, and exposes a post-tool-use hook surface; any SDK that exposes that contract can be wired in without changing the runtime API. Crew's value lives above the SDK, not inside it.

Current-state conventions for code are authoritative in [`../../AGENTS.md`](../../AGENTS.md). Sprint-level designs are tracked outside this repo (Jira and Confluence).

## 1. Context and scope

### 1.1 System context

Any work source feeds a growing catalogue of deployable agent crews; each crew writes to any system of record; the shared runtime provides the guarantees that make every crew safe to run unattended; the **compounding surface** (memory, evidence, evaluation, routing) is where the platform's commercial wedge accumulates with use. Delivery is the first vertical on the platform, not the definition of the platform.

```text
                        [Operator / Reviewer]
                                 |
         ┌───────────────────────┴──────────────────────────────┐
         │                    Crew Platform                      │
         │                                                       │
Work     │  ── Composition layer (Future) ─────────────────────  │
sources  │    Cross-Crew Orchestrator                            │  Systems of
         │      durable pipelines, fan-out, suspend / resume     │  record
· Jira ─►│                                                       │  · VCS host
· GitLab │  ── Crew catalogue ─────────────────────────────────  │    (GitLab/
  webhook│    Delivery vertical (Now)                            │     GitHub —
· CI    ─►│      delivery-build ─► delivery-qa ─► delivery-review│     MRs,
· cron  ─►│                                              ────────┼─►   pipelines)
· ...   ─►│    Code review vertical (Next)                       │  · Jira
         │      code-reviewer  (CLI, npm)               ────────┼─►   (status,
         │    Roadmap verticals (Later/Future)                   │     comments)
         │      product / architecture / discovery / refine      │  · Slack
         │                                                       │  · …
         │  ── Compounding surface (Pro tier, planned) ────────  │
         │    Project memory · Cross-run evidence                │
         │    Evaluation policy · Model routing                  │
         │    Server-side request construction                   │
         │                                                       │
         │  ── Optimisation layer (planned) ───────────────────  │
         │    CrewOptimiser   specialised microservices that      │
         │                    read from the warehouse and         │
         │                    propose policy changes to           │
         │                    @daddia/crew. Not in the call path. │
         │    CrewTelemetry   single-emission OTel events →       │
         │                    durable stream → fan-out to         │
         │                    Honeycomb + data warehouse          │
         │                                                       │
         │  ── Shared runtime ─────────────────────────────────  │
         │    @daddia/crew  (state, workflow, webhooks, config,  │
         │                   audit hooks, bounded-loop guards)   │
         │                                                       │
         │  ── Foundation (pluggable) ─────────────────────────  │
         │    Agent SDK             session create / resume,     │
         │                          tool execution, hook surface │
         │    Foundation model      provider-agnostic; routable  │
         │                          per Pro tier                 │
         │    MCP server fabric     Atlassian, GitLab, …         │
         │    Audit / Observability per-crew SQLite; OTel sink   │
         └───────────────────────────────────────────────────────┘
```

The Foundation layer is pluggable on two axes: the **Agent SDK** (any SDK that exposes session lifecycle, tool execution, and a post-tool-use hook) and the **foundation model provider** (selected per task by the Pro-tier router). The runtime above this layer does not encode a specific SDK or provider.

Three layers sit *above* the individual crew. Together they encode the "compound above the model" thesis from `strategy.md`:

- **Compounding surface (Pro tier, planned).** Project memory, cross-run evidence, evaluation policy, and model routing will live in a managed control plane. The local runtime stays usable without it (free tier); the control plane is what will make runs cheaper and more accurate over time as it lands.
- **Optimisation layer (planned).** Specialised microservices (CrewOptimiser) that read from the telemetry warehouse and propose policy changes to `@daddia/crew` — model routing, prompt deltas, context assembly, escalation thresholds. These never sit in any crew's call path; they operate asynchronously on their own cadence. CrewTelemetry provides the event stream: single-emission OTel events → durable stream → fan-out to Honeycomb (runtime health) and a data warehouse (full payload). See Confluence research: [CrewTelemetry](https://carinyaparc.atlassian.net/wiki/spaces/CREW/pages/1671200), [CrewOptimiser](https://carinyaparc.atlassian.net/wiki/spaces/CREW/pages/1703940).
- **Composition layer (Future phase).** The cross-crew orchestrator treats each crew as a composable, durable step in a longer pipeline — suspend, resume, fan-out, and human gates without coupling individual crews:

```text
[Trigger]  ──►  [Orchestrator]  ──►  [Crew A]  ──►  [Crew B]  ──►  …
                      │                   ^              ^
                      └── suspend / resume / fan-out ────┘
```

### 1.2 System boundary

**Crew owns:**

- The runtime contract: `Agent`, `AgentCrew`, `AgentInput`, `AgentResult`, and the `@daddia/crew` library that implements it. The contract is **SDK-agnostic** — it names sessions, hooks, and bounded loops without naming a vendor.
- The two first-class deployment topologies a crew can adopt:
  - **Server-shaped** — a long-lived Hono service that owns SQLite state, polls a work source, and receives inbound webhooks. Used for stateful, multi-step workflows (all three delivery crews).
  - **CLI-shaped** — an ephemeral package published to npm and invoked in CI. Runs to completion, writes results to the system of record, exits. No persistent state. Used for stateless one-shots (code-reviewer, next).
- Inbound webhook security primitives (`@daddia/crew/webhooks`), typed config (`@daddia/crew/config`), and the bounded-loop / audit-hook / escalation guarantees that apply uniformly across both topologies.
- The **managed control plane** (Pro tier, planned): server-side request construction, persona policy resolution, contract schema registry, evaluation policy, and routing decisions. Local fallback will always be available; the control plane is the compounding lever, not a hard dependency for any single run.
- The future cross-crew orchestration layer (Future phase).

**Crew does not own:**

- **The agent SDK or the foundation model.** Crew is a runtime layer on top of *an* agent SDK, not a specific one. Today the codebase is wired to a single SDK because that is what was needed to ship; the runtime contract was designed so a second SDK could be wired in by writing an adapter, not by refactoring crews. Foundation model selection is a Pro-tier routing decision — never a runtime assumption.
- External domain models (Jira issue structure, GitLab MR schema) — consumed via thin idempotent integration clients; each crew owns its own clients.
- Tool implementations exposed via MCP — Crew configures servers; it does not ship them.
- The operator's workspace (product docs, conventions, skills, program mirrors). Crew reads from a documented filesystem surface; the workspace layer is out of scope for this product (see `strategy.md` §4).
- The operator's workflow definition — each crew owns its own `workflow.ts`, personas, prompts, and definition of done.

### 1.3 Upstream and downstream systems

- **Upstream — Work source (Jira today; pluggable).** Provides the work queue and lifecycle states for server-shaped crews. CLI-shaped crews receive context from CI env vars or invocation arguments instead. State transitions are idempotent in both topologies.
- **Upstream — Agent SDK + foundation model + MCP servers.** Provide session lifecycle, reasoning, and tool surfaces. The SDK is pluggable behind Crew's runtime contract; the model provider is selected per task by the Pro-tier router. Cost and latency budgets are enforced at the crew runtime, regardless of which SDK or model is in use.
- **Upstream / bidirectional — Managed control plane (Pro tier).** Resolves persona policies, evaluation rubrics, and routing decisions server-side; ingests every run's evidence into the cross-run memory store. Crews call out at session start and at policy-decision points; degrade-to-local on control-plane unreachability is a first-class behaviour.
- **Downstream — System of record.** VCS host (branches, MRs, pipeline status) for delivery crews; PR comment threads for the code-reviewer; other surfaces for future verticals.
- **Downstream — Audit + observability sinks.** Structured logs, OTel traces (planned), cost-per-run metrics, and the per-step audit trail.
- **Downstream — Telemetry stream (planned).** OTel-compliant events emitted to a durable stream, fanning out to Honeycomb (runtime health) and a data warehouse (full payload). The warehouse is the shared read surface for CrewBench, the optimisation layer, and any downstream consumer.
- **Downstream — Evidence layer (Pro tier).** Provenance, evaluator verdicts, and cost telemetry feed the cross-run learning loop. Same audit envelope; different consumer.
- **Future bidirectional — Cross-crew orchestrator.** Triggers crews via the same event surface they accept today; consumes `ready-for-*` handoff events to advance long-running pipelines.

## 2. Quality goals and constraints

### 2.1 Quality goals (top 6, ordered)

1. **Auditability.** Every crew action is reconstructible from the per-crew
   audit trail without consulting the operator. The audit trail is the
   product (see `strategy.md` §8).
2. **Bounded operation.** Every loop has a cap, every external call a
   timeout, every run a cost ceiling. Unbounded automation is unbounded
   spend.
3. **Autonomy with clean escalation.** When a crew cannot proceed with
   confidence it escalates to a human with full context — silent failure
   is worse than visible escalation. The escalation path is a feature.
4. **Reproducible deployability.** A new crew goes from blank slate to
   deployed service by writing workflow + personas + prompts only.
   "Time to first crew" is the leverage metric.
5. **Composability.** Crews are independent at the unit and composable at
   the orchestration layer. A crew that runs correctly in isolation must
   continue to run correctly when a pipeline is added around it.
   Independence is the precondition; composition is the value. The delivery
   pipeline (three independent crews coordinated by state transitions) is
   the first proof of this property.
6. **Compounding value above the model.** Cost per accepted artefact must
   trend down, and recall across runs must trend up, as the platform
   accumulates evidence and memory — independently of any single model
   release. Architecture choices that prevent compounding (per-run
   isolation, no shared learning surface, opaque evaluation) are rejected
   by design. The control plane is the seat of this goal.

A seventh consideration shapes every other decision but is not itself a
runtime quality goal: **legibility to agents.** Module boundaries, names,
and contracts are chosen so an AI agent — including Crew itself — can
locate, reason about, and modify the right code without an oral handoff.
This is an authoring constraint (`AGENTS.md`), not a runtime measurement.

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
| 2   | **Shared runtime, crew-owned policy.** `@daddia/crew` owns mechanism (session, audit hook, bounded-loop guard, webhook verification, typed config, state store implementation, workflow execution engine). Each crew owns intent (workflow plan, personas, prompts, definition of done).                                                                                                                               | A sharper API surface on the shared package; rewarded by every new crew picking up runtime fixes for free.                                           | Reproducible deployability      |
| 3   | **Bounded loops and audit hooks are non-optional.** `boundedIterGuard()` wraps every refactor / CI-fix / remediation loop; `buildAuditHook()` wraps every persona run. Not opt-in — they are how a crew is built, in every vertical.                                                                                                                                                                                   | Less freedom for an "experimental" crew to skip controls; rewarded by every crew in the catalogue being safe to run unattended.                      | Auditability, Bounded operation |
| 4   | **Idempotent fire-and-forget now; durable orchestration later.** Handlers verify, deduplicate, return 200, run the workflow async. The Future-phase orchestrator sits above crews — it doesn't change how they receive events.                                                                                                                                                                                         | A crashed partial run is recovered by a per-crew startup scan, not an external scheduler; acceptable until the second crew ships.                    | Autonomy with clean escalation  |
| 5   | **One process per tenant, one tenant per process.** Each instance is single-tenant by construction; the operational unit is the container (server) or the process invocation (CLI). Fleet management lives above the crew, not inside it.                                                                                                                                                                              | Horizontal scale = more containers, not more threads; rewarded by trivial blast-radius isolation.                                                    | Composability                   |
| 6   | **Runtime shape pluralism.** The `Agent` / `AgentCrew` contract is shape-agnostic. A crew deploys as a **server** (long-lived, stateful, polls + receives webhooks) for multi-step workflows, a **CLI package** (ephemeral, published to npm, invoked in CI) for stateless one-shots, or a **scheduled batch** (cron-triggered) for periodic work. Same audit, bounded-loop, and escalation guarantees in every shape. | The shared runtime API must remain topology-neutral; server-only helpers (`verifySignature`, crash recovery) cannot be imported by CLI-shaped crews. | Reproducible deployability      |
| 7   | **Local-first runtime, managed compounding.** Every crew runs end-to-end with local-only config (free tier). The managed control plane (Pro tier, planned) will layer compounding capabilities — memory, evidence ingestion, evaluation policy, model routing — server-side. Crews call out at session start and at policy points and **degrade to local** on control-plane unreachability. The contract is one-way: local works without managed; managed enhances local without owning it. | Two code paths to keep consistent; rewarded by free-tier credibility and a clear commercial moat that does not break self-host.                      | Compounding value above the model |
| 8   | **Legible to agents.** Module boundaries, file names, and contracts are chosen so an AI agent can locate the right code on the first search and modify it without an oral handoff. Names are explicit (no clever abbreviations); side effects are local to the file that names them; cross-module coupling goes through named exports, never via global mutation.                                                      | Slightly more verbose code and more files than a human-only codebase would warrant; rewarded by Crew being extended by Crew safely.                  | Authoring constraint (see §2.1) |
| 9   | **Agent SDK-agnostic, model-agnostic.** The `Agent` contract names sessions, tool execution, and a post-tool-use hook surface — never a specific SDK. The foundation model is selected per task by the Pro-tier router (or pinned in config); no crew imports a vendor SDK directly. Today the codebase is wired to one SDK because shipping demanded it; a second SDK is an adapter, not a refactor. | A small abstraction tax at the runtime boundary; rewarded by insulation from any single vendor's roadmap, deprecation, or pricing shift.             | Compounding value above the model |
| 10  | **Filesystem-first authoring.** Personas, skills, subagents, and crew policy are files at predictable paths; the path is the identifier. No parallel registry. Conventions are documented in `AGENTS.md` and enforced mechanically in CI (`guard:invariants`). Runtime docs ship inside the published package so agents extending Crew read contracts locally. | Slightly more directory structure than a single config object; rewarded by inspectability, diffability, and agent legibility — the catalogue scales by adding files, not by editing a central registry. | Reproducible deployability, Authoring constraint |

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

  ── Compounding surface (Pro tier; managed control plane — planned) ──────
     Server-side request construction   persona policy + skill resolution
     Project memory                     cross-run context retrieval
     Evaluation policy                  rubrics + divergence thresholds
     Model routing                      provider selection per task
     Evidence ingestion                 every run feeds the next

  ── Optimisation layer (planned) ─────────────────────────────────────────
     CrewOptimiser    model selector, token optimiser, context manager,
                      prompt optimiser, escalation analyser, cost monitor
                      — read from warehouse, propose policy changes to
                      @daddia/crew via PRs. Not in the call path.
     CrewTelemetry    single-emission OTel events → durable stream →
                      fan-out to Honeycomb + data warehouse

  ── Shared runtime ────────────────────────────────────────────────────────
     @daddia/crew  (main)      Agent, AgentCrew, AgentInput, AgentResult
                               resolveSession, buildAuditHook, boundedIterGuard
                               readPromptFile, readSkillsDir, readSubagentsDir
                               Orchestrator, AgentRegistry
     @daddia/crew/webhooks     verifySignature, checkReplayWindow, idempotency
     @daddia/crew/config       loadEnv, loadYaml, Secret brand, redact
     @daddia/crew/state        StateStore interface, createSqliteStateStore
     @daddia/crew/workflow     WorkflowEngine, WorkflowPlan, FailurePolicy
     @daddia/crew/evals        [Next] defineEval, crew eval CLI, expect matchers
     @daddia/crew/tools        [Next] typed crew-local tools + approval metadata
     @daddia/crew/control      [Pro, planned] control-plane client + local fallback
     @daddia/crew/events       [Future] typed cross-crew event contracts
     docs/ (bundled)           [Next] AGENTS.md excerpts + contributor guides in npm package

  ── Foundation (pluggable) ────────────────────────────────────────────────
     Agent SDK                 session create / resume, tool execution,
                               post-tool-use hook surface. Wired to one
                               SDK today; adapter pattern for additional
                               SDKs without runtime API change.
     MCP server fabric         Atlassian, GitLab, and crew-specific servers
     Foundation model          provider-agnostic; selected per task by
                               Pro-tier routing (or pinned in config)
     Audit / Observability     per-crew SQLite today; OTel sink (planned)
```

The compounding surface is **optional at runtime** and **commercial at the business model**. A crew with no Pro-tier configuration executes its workflow locally with the same correctness guarantees; the control plane adds cost reduction and quality lift, not gating.

The Foundation tier is **pluggable but not abstracted prematurely**. The runtime contract names what every SDK must expose (sessions, tool execution, a hook surface); a second SDK is added by writing one adapter, not by changing crew code. This is principle 9 (§3) made operational.

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
    agents/{persona}/ agent.ts, prompt.md, plugin/{skills,agents}/
    handlers/         One file per inbound event source (verified, idempotent)
    integrations/     Thin idempotent clients for external systems
    evals/            [Next] fixture-owned CrewBench evals (*.eval.ts)
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
    agents/{persona}/ agent.ts, prompt.md, plugin/{skills,agents}/
    integrations/     Thin idempotent clients for external systems
    evals/            [Next] fixture-owned CrewBench evals (*.eval.ts)
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

### 4.3 Filesystem authoring model

Crew authors do not assemble a large configuration object. They add files under
known paths; the runtime discovers and compiles them. This is the authoring
interface for both humans and AI agents extending the platform.

**Canonical persona tree** (server- and CLI-shaped):

```text
agents/{persona}/
  agent.ts              exports const {persona}: Agent
  prompt.md             always-on system prompt (instructions)
  plugin/
    skills/             SKILL.md procedures (load on demand — Next)
    agents/             subagent .md definitions
    .claude-plugin/     SDK plugin manifest when required
```

Path-derived identity: `plugin/skills/implement-story/SKILL.md` is the
`implement-story` skill. Shared skills graduate to `@daddia/crew/plugins/`
and are referenced by name — never copied across crews.

**Crew-level slots** (add only when needed):

| Path | Purpose |
|------|---------|
| `workflow.ts` | Only file that knows the delivery sequence |
| `handlers/` | Inbound event sources (today); generalises to channels (Later) |
| `integrations/` | Idempotent clients for systems of record |
| `schedules/` | Cron-authored batch triggers (Later) |
| `evals/` | CrewBench eval files + `evals.config.ts` (Next) |
| `mcp.json` | MCP server declarations |

**Scaffolding.** `crew init` (Next) creates this tree from a template, pins
`@daddia/crew`, and includes a smoke eval stub. Manual `cp -r` is deprecated
once init ships.

**Convention enforcement.** `guard:invariants` (Next) complements ESLint and
dependency-cruiser: crash-recovery ordering before `agent.run()`, no
`process.env` outside `config.ts`, no crew→crew imports, no duplicate skill
trees. Prose in `AGENTS.md` teaches; the guard enforces.

**Bundled documentation.** The published `@daddia/crew` package includes a
`docs/` subtree so coding agents read runtime contracts from
`node_modules/@daddia/crew/docs` without network access.

### 4.4 Durability layers

Two durability scopes coexist by design:

| Layer | Scope | Mechanism today | Planned enhancement |
|-------|-------|-----------------|---------------------|
| **Workflow** | Story / step across personas | Per-crew SQLite (`stories`, `steps`); startup recovery scan | Unchanged — domain-specific |
| **Session** | Single persona run | SDK session resume (`resumeWithinMs`); `maxTurns` / cost cap | Context compaction (Next) |
| **Turn** | In-run tool checkpoints | Not yet — mid-implementation crash may replay tool work | Step checkpointing research (Future) |
| **Pipeline** | Cross-crew handoffs | Jira state + `ready-for-*` events; poll fallback | Orchestrator suspend/resume (Future) |

Story-level recovery is necessary for unattended crews. Turn-level checkpointing
inside long `implement-story` runs is a Future-phase research item (CREW-20) —
evaluated before the cross-crew orchestrator depends on it.

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

**Artefact** — any versioned, reviewable output that encodes a decision, a deliverable, or a lesson: a merged MR, a Jira comment, a design doc, a convention file, a prompt, a reflection proposal. "Cost per accepted artefact" and "artefacts are the source of truth" both use this definition. Not a log line, not in-process state, not an ephemeral message. **Crew** — independently deployable agent service (one workflow, one team of personas, one deployment unit — a container for server-shaped crews, a published package for CLI-shaped crews). **Persona** — a named role (`engineer`, `senior-engineer`, `tech-lead`, `code-quality`) implementing the `Agent` interface. **Workflow** — deterministic sequence in `workflow.ts`; the only file that knows the sequence. **Run** — one workflow execution for one story, identified by `(crew, issueKey)`. **Step** — one persona invocation or external integration call within a run. **Escalation** — terminal "needs human" exit path; comment + status transition + structured log. **Bounded loop** — any iteration capped by an env-driven cap (`REFACTOR_LOOP_CAP`, `CI_RETRY_CAP`, `QA_DEFECT_LOOP_CAP`, ...). **Handoff event** — `ready-for-{stage}` signal emitted when a crew finishes its slice.

## 7. Cross-cutting concepts

| Concept                                     | Pattern                                                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit trail**                             | `buildAuditHook()` attached to every persona run; every tool call logged with cost and verdict. The audit trail is the product. Storage per topology — see §6.1.                                                                      |
| **Bounded operation**                       | `boundedIterGuard()` wraps every refactor / CI-fix / remediation loop; throws `IterationCapReached` on cap.                                                                                                                           |
| **Tool safety**                             | Two-layer allowlist: SDK `allowedTools` + `buildToolAllowlistGuard` at pre-execution; `buildAuditHook` for post-execution audit. Per-tool approval metadata for destructive operations (Next). Typed crew-local tools via `@daddia/crew/tools` (Next). |
| **Context control**                         | Always-on `prompt.md`; skills loaded progressively by description (Next); context compaction before window overflow on long runs (Next). Untrusted author text fenced before inclusion in prompts. |
| **Eval quality (CrewBench)**                | Fixture-owned `evals/*.eval.ts` per crew; `crew eval` drives real sessions; gate vs soft assertions; CI `--strict` (Next). Same surface production uses — a passing eval means the crew booted and met contract. |
| **Security model**                          | Trust boundaries documented in [`security-model.md`](security-model.md): runtime (secrets, MCP) vs workspace (cloned repo) vs model-visible prompt data. Webhook signature verification; fail-closed defaults. Pre-production checklist in [`delivery-build` runbook](../runbook/delivery-build.md) §7. |
| **Operator visibility**                     | Structured logs and OTel today; run-stream or equivalent live progress for overnight batches (Next); subagent runs correlated to parent story in audit. |
| **Idempotency**                             | Server crews: external writes key on `issueKey` or `(provider, event_id)`; `webhook_events` dedup. CLI crews: the system of record is the dedup store — check before write, keyed on the natural identity of the run (e.g. MR + SHA). |
| **Configuration**                           | One typed `Config` per crew; `process.env` only inside `config.ts` (lint-enforced); secrets branded and redacted from logs.                                                                                                           |
| **Webhook security** _(server-shaped only)_ | `verifySignature()` + `checkReplayWindow()` + dedup store, all from `@daddia/crew/webhooks`, before body parse. CLI crews have no inbound surface.                                                                                    |
| **Observability**                           | Structured logs today; OTel traces + cost-per-run metrics planned (CREW-55-001). One boot log answers "what config is this running with?"                                                                                             |
| **Telemetry** _(planned)_                   | Single-emission OTel-compliant events per significant action, emitted to a durable stream (RabbitMQ or equivalent). Stream fans out to two consumers: Honeycomb (filtered attributes, runtime health) and a data warehouse (full payload — prompts, context, outputs, costs). The warehouse is the shared read surface for CrewBench, the optimisation layer, and any future consumer. Correlation across crews and external systems (GitLab, Jira) is by natural-key attribute matching in the warehouse, not by embedding trace IDs in external systems. See Confluence research: [CrewTelemetry](https://carinyaparc.atlassian.net/wiki/spaces/CREW/pages/1671200), [CrewOptimiser](https://carinyaparc.atlassian.net/wiki/spaces/CREW/pages/1703940). |
| **Crash recovery** _(server-shaped only)_   | Startup scan resumes interrupted SDK sessions or escalates; completes before HTTP server and poller start. CLI crews are retried by CI at the job level.                                                                              |
| **Project memory**                          | Personas seed project memory at run start; reduces repeated context cost across runs. Pro-tier control plane serves memory server-side and ingests results back into the cross-run store.                                             |
| **Control plane (Pro tier)**                | `@daddia/crew/control` resolves persona policy, evaluation rubric, model routing, and request shape at session start. Every call carries a local fallback; a control-plane outage degrades runs to local resolution, never blocks them. |
| **Evidence ingestion (Pro tier)**           | Every run emits a provenance envelope (`run id`, persona, cost, verdict, tools, contract validation result). Server crews flush asynchronously after each step; CLI crews flush at exit. Same envelope, two transports.               |
| **Evaluation policy**                       | Self-evaluation runs on every persona output against a rubric. Pro-tier crews ship divergence thresholds and multi-model evaluation; free tier ships single-model rubric only.                                                        |
| **Model routing (Pro tier)**                | Per-task model selection (e.g. cheap model for triage, strong model for implementation) routed through `@daddia/crew/control`. Provider credentials remain in the crew's typed config.                                                |
| **Testing**                                 | Vitest unit + integration tests per package and per crew; one `pnpm test` runs everything.                                                                                                                                            |

## 8. Deployment and environments

One deployment unit per crew; the unit's shape follows the crew's topology.

**Server-shaped crews** deploy as containers on a managed runtime (Railway
today) with SQLite on a named volume; secrets are injected as service env
vars. Local: `pnpm dev` per crew or `docker compose up` for full-container
smoke (`docs/runbook/container.md`). One container per crew, end to end.

**CLI-shaped crews** publish to public npm via Changesets on merge to
`main`; consumers invoke the crew with `npx @daddia/crew-{name}` in their CI
pipeline (or pin the version in their job config). No persistent runtime;
each invocation opens a session, runs to completion, ships an audit
envelope (§6.1) to the configured sink, and exits. Local: `pnpm dev` runs
the CLI against a fixture.

**Both topologies depend on `@daddia/crew` from the public npm registry** —
the runtime contract is identical. CI runs
`pnpm lint && typecheck && test && build` on every PR (GitHub Actions,
planned in CREW-64).

**Managed control plane (Pro tier, planned).** A hosted service that will
resolve persona policy, evaluation rubric, model routing, and contract
schema server-side, and ingest evidence from every run. Crews will
authenticate with a licence key configured via `@daddia/crew/config`.
Tenant isolation is by licence-scoped namespace. The non-negotiable
design contract: crews **must not** require the plane to be reachable
for correctness — every control-plane call has a local fallback that
produces an identical run shape with reduced compounding (no routing,
single-model evaluation, local memory only). The first surface lands as
part of the Next-phase commercial foundations and will be enforced by
integration tests in `packages/crew` that exercise both code paths.

**Future-phase additions:**

- Durable orchestration service subscribing to `ready-for-*` events.
- Fleet manifest mapping tenants → crew instances (`fleet.yaml`).
- OTel collector for unified traces.
- Managed audit sink to replace per-tenant sink configuration.
- Multi-region control-plane deployment once compliance-driven adopters
  require data residency.

## 9. Architectural decisions (ADR log)

Architectural decisions are inferred from the current codebase and product
direction. Authoring them as MADR entries under [`decisions/`](decisions/)
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
| ADR-009 | Managed control plane is the Pro-tier surface; every control-plane call has a local fallback that produces a valid run with reduced compounding              | _(Not yet written)_ |
| ADR-010 | Authoring constraint: code, contracts, and conventions optimised for AI-agent reasoning (legibility-to-agents) alongside human readability                    | _(Not yet written)_ |
| ADR-011 | Evidence envelope is uniform across topologies and tiers; storage and consumer vary, schema does not                                                          | _(Not yet written)_ |
| ADR-012 | Agent SDK is pluggable behind the `Agent` contract; foundation model is selected by Pro-tier routing; no crew imports a vendor SDK directly                   | _(Not yet written)_ |
| ADR-013 | Filesystem-first authoring: path-derived identity, no parallel registry; conventions enforced mechanically in CI                                                | _(Not yet written)_ |
| ADR-014 | CrewBench evals exercise the production session surface; prompt/harness changes require eval gate before unattended deploy                                      | _(Not yet written)_ |

## 10. Risks, technical debt, and open questions

### 10.1 Risks

| ID  | Risk                                                                              | Likelihood | Impact | Mitigation                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Foundation model cost drift makes autonomous runs uneconomic                      | Medium     | High   | Per-run cost cap; cost-per-run reported per crew; alert on rising trend. Pro-tier model routing selects cheaper models for low-complexity tasks; compaction and memory reduce per-run token spend.            |
| R2  | Fire-and-forget event model loses a handoff between crews                         | Medium     | Medium | Polling fallback on every consuming crew until durable orchestrator ships.                                                                                                                                    |
| R3  | Shared runtime API churn breaks deployed crews silently                           | Low        | High   | Semver via Changesets; crews pin a minor; integration tests on every release.                                                                                                                                 |
| R4  | Single-container deployment becomes a bottleneck at server-shaped fleet scale     | Low        | Medium | Defer until second server-shaped crew is in production; revisit topology then.                                                                                                                                |
| R5  | Audit trail volume outpaces local SQLite                                          | Low        | Medium | Plan shipping audit events to an external sink in the Next phase.                                                                                                                                             |
| R6  | CLI-shaped crew loses run audit if invoked without a remote audit sink configured | Medium     | High   | Fail fast at CLI startup if `AUDIT_SINK_URL` (or equivalent) is unset; tested in `crews/{name}/tests/cli.boot.test.ts`. The audit trail is the product — running without it is not a permitted degraded mode. |
| R7  | CLI-shaped crew double-acts on the same target across two CI invocations          | Medium     | Medium | The system of record is the dedup store: the workflow checks for its prior write at the same key (e.g. existing AI-bot comment on the MR at the same SHA) before acting. Tested per crew.                     |
| R8  | Control-plane outage blocks Pro-tier runs                                         | Medium     | High   | Every control-plane call has a typed local fallback; integration tests cover both code paths; outages degrade runs (no routing, single-model evaluation, local memory only) but never block them.             |
| R9  | Frontier-model capability jump commoditises the runtime layer                     | Medium     | High   | The compounding surface (memory, evidence, evaluation, routing) is the moat — orthogonal to model capability. CrewBench validates that Crew + a current model beats raw current model on cost and recall.    |
| R10 | "Legible to agents" erodes over time as patches and shortcuts accumulate          | Medium     | Medium | `AGENTS.md` is authoritative; pre-merge checklist requires that an AI agent can describe the change without an oral handoff. Refactor budget per quarter to repay clarity debt.                                |
| R11 | Catalogue growth outpaces shared-runtime test coverage                            | Low        | Medium | Each new crew adopts the runtime contract test suite at scaffolding time; runtime fixes ship with backport tests that exercise every catalogued crew.                                                         |
| R12 | Single-SDK wiring becomes de-facto vendor lock as crews multiply                  | Medium     | Medium | The `Agent` contract is SDK-agnostic and tested independently of any one SDK; adding a second SDK is gated on a real driver (second model provider, capability gap, or pricing event) — not done speculatively, but the contract stays adapter-shaped so the second SDK is one file, not a refactor. |

### 10.2 Technical debt

- **OTel tracing not yet wired.** Structured logs cover most needs; tracing
  closes when CREW-55-001 ships.
- **No GitHub Actions yet.** Local `pnpm lint` is the gate; CI lands in CREW-64.
- **Architectural decisions are implicit.** ADRs §9 should be authored as
  MADR entries; until then, this document is the canonical reference.

### 10.3 Open questions

1. **What is the remote audit sink implementation for CLI-shaped crews?**
   The leading candidate is the same durable stream + warehouse that the
   telemetry architecture routes all events through (see CrewTelemetry
   research) — the audit sink may not be a separate system but a consumer
   of the shared event stream. Other candidates: managed Postgres or a
   hosted audit service (e.g. Logfire, Honeycomb-on-events).
   Owner: daddia. **Blocks: code-reviewer (the first CLI-shaped crew) ship.**
   Required output is the `@daddia/crew/audit` API surface plus one
   reference-implementation transport.
2. **Where does the cross-crew orchestrator live?** A new top-level
   `crews/` service, a separate package, or a managed offering (e.g.
   Temporal, Inngest)? Owner: daddia. Blocks: nothing in Now/Next phases;
   required before Future phase.
3. **What is the second crew?** `code-reviewer` is scaffolded as the first
   CLI-shaped crew and named throughout the roadmap. It validates both the
   "shared runtime, crew-owned policy" principle and the CLI topology
   contract. Its ship is gated on the remote audit sink (Q1 above).
   Owner: daddia. Blocks: graduation of any pattern under §11.
4. **How is multi-crew cost reported?** Per-crew is solved; portfolio-level
   roll-up is unowned. Owner: daddia. Blocks: portfolio-scope reporting.
5. **What is the control-plane contract version policy?** Server-side
   schemas need to evolve without breaking deployed crews pinned to an
   older `@daddia/crew`. Candidates: versioned endpoints, content
   negotiation, or shadow-mode rollout with both schemas live. Owner:
   daddia. Blocks: a published control-plane SLO and second Pro-tier
   feature.
6. **Where do cross-run memory boundaries sit?** Per-crew, per-tenant,
   per-licence, or per-vertical? Affects evidence-layer schema and
   retrieval semantics. Owner: daddia. Blocks: cross-vertical learning
   experiments (Later phase).
7. **What durability engine backs turn-level checkpointing?** Candidates:
   workflow-style step stores, SDK-native resume extensions, or a thin
   Crew-owned checkpoint log. Owner: daddia. Blocks: CREW-20 research
   and Future orchestrator design.
8. **When does execution isolation graduate from host workspace to sandbox?**
   Trigger: first catalogue crew operating on untrusted forks or user code.
   Owner: daddia. Blocks: CREW-19.

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
| ADRs                                                         | This document, §9                                                  | `decisions/{id}.md` (MADR)                                                            | Any decision in §9 is contested or revisited.                                                                                                                              |
| Cross-crew handoff event schema                              | Implicit in `ready-for-*` log lines                                | `@daddia/crew/events` (typed contracts)                                               | Cross-crew orchestrator design begins (Future phase).                                                                                                                      |

**Platform-level patterns** (lift when the platform itself warrants the abstraction):

| Pattern                    | Current home                                                                 | Graduate to                                         | Trigger                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crew catalogue / discovery | Implicit in `crews/` directory listing                                       | `@daddia/crew/catalogue` (manifest + discovery API) | Five or more crews exist and a new crew needs to locate another crew's entry point or event schema programmatically.                               |
| Fleet manifest             | Manual deployment of one container per crew                                  | `fleet.yaml` (crew type → instance count mapping)   | A tenant needs to run more than one instance of the same crew type simultaneously (e.g. two delivery-build instances for different Jira projects). |
| Control-plane fallback     | Inlined within `@daddia/crew/control` (per-feature switch)                   | Documented degradation matrix in `docs/runbook/`    | Second Pro-tier feature ships and the matrix of "what works without managed?" stops fitting in a single inline comment.                            |
| Evidence schema            | Inlined in `@daddia/crew` step records (server) and CLI audit envelope (§6.1) | `@daddia/crew/evidence` (typed envelope + emitter)  | Second consumer of the evidence stream lands (e.g. a dashboard or external benchmark ingester).                                                    |
| Multi-model evaluation     | Persona-level self-eval inside each crew                                     | `@daddia/crew/evaluation` (rubrics + divergence)    | Pro-tier multi-model evaluation needs to apply to a second persona or crew.                                                                        |
| CrewBench eval framework   | Vitest unit tests only                                                       | `@daddia/crew/evals` + `crew eval` CLI               | CREW-15 ships; second crew needs regression gate before unattended prompt changes.                                                                 |
| `crew init` scaffold       | Manual `cp -r crews/delivery-build`                                          | `@daddia/crew` CLI or `create-crew` package          | Third crew scaffolds; copy-paste drift observed.                                                                                                     |
| Invariant guard            | ESLint + dependency-cruiser only                                             | `guard:invariants` in root CI                        | CREW-14; second convention violation merges without mechanical catch.                                                                              |
| Channel adapter            | Per-handler Hono routes in `handlers/`                                        | `@daddia/crew/channels` (defineChannel)              | Second ingress surface (Slack or generic HTTP) duplicates handler boilerplate.                                                                     |
| Schedule authoring         | `poller.ts` only                                                             | `schedules/` convention + host cron compile          | First scheduled-batch crew (Later).                                                                                                                |
| Execution isolation        | Host workspace + workspace-lock                                                | `@daddia/crew/sandbox` adapter                       | Catalogue crew needs untrusted code execution (Later).                                                                                             |
