---
type: Product Roadmap
scope: product
version: '2.0'
owner: daddia
status: Current
last_updated: 2026-06-26
related:
  - docs/product/strategy.md
  - docs/architecture/solution.md
---

# Roadmap -- Crew

## 1. Roadmap intent

This roadmap sequences the build of the Crew platform from a single proof-point
crew to a hardened runtime carrying a growing catalogue, then to the compounding
surface that differentiates the platform from raw model calls. It derives from
the bets in [`strategy.md`](strategy.md) §2 and the architecture in
[`solution.md`](../architecture/solution.md); it expresses phases as **outcomes
and capabilities**, not epics. Epic and story decomposition lives downstream in
the backlog and in Jira; this document is what that decomposition is sequenced
_against_.

Phasing matters because the substrate is earned, not assumed. The first crew is
expensive precisely so every later crew is cheap. Calendar dates are not
committed: a phase opens only when the previous phase exits cleanly against its
named criteria. Phases are sequential; parallelism lives _within_ a phase.

## 2. Sequencing logic

1. **Prove the hardest crew first.** The build crew is the most demanding
   workload — multi-persona, multi-phase, external integrations, bounded loops,
   human gates. Earning crash recovery, audit, bounded loops, and escalation on
   the hardest crew means every later crew inherits a runtime that has already
   paid for the hard parts.
2. **Deterministic floor before agentic flexibility.** Ship the reviewable,
   deterministic workflow end-to-end before any model-generated orchestration.
   Model-decided team/sequence/tool-surface (Level 3, [`solution.md`](../architecture/solution.md) §5.6)
   stays default-off and eval-gated — it returns only when a shipped workflow's
   evals prove it stays auditable and bounded.
3. **Borrow substrate, don't rebuild it.** Durable execution, sandboxing,
   channels, and durable human-in-the-loop are substrate, not differentiation
   ([`solution.md`](../architecture/solution.md) §11, principle 12). They are
   adopted from maintained dependencies _only when a shipped workflow needs them_
   — never speculatively, never rebuilt by hand.
4. **Quality and authoring infrastructure gate catalogue growth.** Eval-on-the-
   production-surface and one-command scaffolding land alongside the second crew,
   before copy-paste drift can set in. No prompt or harness change ships
   unattended without an eval gate.
5. **Compounding lands after the vertical closes.** Memory, evidence, evaluation
   policy, and routing — the commercial moat — invest only once the delivery
   vertical runs unattended-safe. A wedge with no proof point is a liability.

## 3. Phases

### Phase 1 -- Now -- prove delivery on the platform

**Objective:** The build crew runs end-to-end on real stories, unattended, on a
runtime that has earned the right to carry the catalogue.

**Capabilities:**

- Shared runtime (`@daddia/crew`) — `main`, `webhooks`, `config`, `state`,
  `workflow` subpaths published and consumed by crews as a pinned dependency.
- Build crew — engineer + senior-engineer; context seed → clarification →
  implement → peer review → open MR → CI check → hand off; bounded loops and
  escalation on every failure path.
- Production readiness — diagnostics, cost-per-run logging, `/healthz`, an
  operations runbook, and an e2e smoke against a live board.

**Quality gates:**

- Diagnostics pass all integration touch points against live credentials.
- Every workflow completion emits total cost, duration, and a per-step breakdown.
- All escalation paths (loop cap, clarification timeout, agent failure) reach
  "Needs human review" without crashing the server.

**Exit criteria:**

1. Diagnostics, cost-per-run logging, `/healthz`, runbook, and an e2e smoke
   against a real board are all in place.
2. Three or more stories reach the hand-off step via the autonomous path (poll or
   webhook), with provenance recorded per run.
3. Escalation paths verified end-to-end: loop cap, clarification timeout, and
   agent failure all surface to humans without crashing the server.

**Out of scope for this phase:** QA and review crews; the eval framework;
authoring scaffolding; any compounding-surface work; channels and schedules.

### Phase 2 -- Next -- harden the runtime; close the delivery loop

**Objective:** The full delivery vertical (build → QA → review) runs unattended
overnight, with quality and authoring infrastructure that makes the second crew
cheaper than the first and keeps every runtime change eval-gated.

**Capabilities:**

- QA and review crews operational; handoff events (`ready-for-qa`,
  `ready-for-review`) wired so downstream crews self-trigger.
- Remote audit sink (`@daddia/crew/audit`) — the prerequisite for the first
  CLI-shaped crew.
- First CLI-shaped crew (code-reviewer) shipping on the audit sink.
- OTel tracing across crews; outcome telemetry and a durable event stream
  fanning out to runtime-health and warehouse sinks.
- Authoring ergonomics — one-command crew scaffolding, runtime docs bundled in
  the published package, and mechanical invariant enforcement in CI.
- Eval framework on the production surface — fixture-owned evals per crew, gate
  vs soft assertions, a baseline populated before prompt/harness changes ship.
- Harness hardening — progressive skill loading, context compaction on long
  runs, and an operator run-stream for overnight batches.
- Security model — runtime/workspace/MCP trust boundaries and a pre-production
  checklist _(shipped)_.
- Commercial foundations — licence gating and the first surface of the managed
  control plane sketched.

**Quality gates:**

- At least one fixture-owned eval per deployed crew runs in the eval/release
  pipeline (not the CI workflow); a prompt or harness regression fails before
  unattended deploy.
- A completed story's run joins to its MR outcome and its cost breakdown in a
  single warehouse query.
- A new crew scaffolds from the template and reaches a passing smoke eval without
  copying an existing crew by hand.
- Invariant enforcement blocks env-isolation, crash-recovery-ordering, and
  dependency-boundary regressions in CI.

**Exit criteria:**

1. An overnight run completes without operator intervention; the morning report
   shows autonomy rate and cost per story.
2. Downstream crews pick up handoffs without manual re-trigger.
3. Eval baseline populated; cost-per-accepted-feature trend is visibly improving
   release over release.
4. Outcome telemetry pipeline operational (single-emission events → durable
   stream → runtime-health + warehouse).
5. The first CLI-shaped crew ships on the remote audit sink.

**Out of scope for this phase:** model-generated workflow plans (Level 3);
execution isolation / sandbox; channel and schedule generalisation; the full
Pro-tier compounding surface.

### Phase 3 -- Later -- open the catalogue

**Objective:** Additional verticals run on the same runtime — each new crew is
workflow + personas + prompts — and the Pro-tier compounding surface begins to
make every run cheaper and more accurate than the last.

**Capabilities:**

- Discovery crews (PM, Architect) feeding ready stories into delivery; a
  documentation / release-notes crew; a customer-issue triage crew.
- Pro-tier compounding surface — project memory, evaluation policy, and model
  routing; the first optimiser (model selector) ships as the highest-leverage
  specialist.
- Ingress conventions — webhook handlers generalised into a channel adapter
  pattern, plus scheduled-batch topology as first-class crew files.
- Optional execution isolation (sandbox) for catalogue crews operating on
  untrusted or forked code — adopted as borrowed substrate, not built.
- Dynamic policy (local tier) — per-project / per-tenant skill and prompt
  resolution; the seed of the Pro control plane without managed infrastructure.

**Quality gates:**

- A new vertical reaches its first unattended run reusing the substrate with no
  runtime change beyond a version bump.
- The first optimiser demonstrates a measurable cost-quality improvement against
  an eval baseline before it influences any crew's routing.
- Every control-plane call degrades to local on unreachability — proven, not assumed.

**Exit criteria:**

1. At least one non-delivery crew runs a real workload unattended on the shared runtime.
2. Cost per accepted artefact trends down and recall trends up after the
   compounding surface lands — the platform-improves-with-use proof.
3. The Pro tier is purchasable: pricing model, free/Pro boundary, licence
   enforcement, and an eval proof pack (documented wins and at least one loss)
   are all resolved.

**Out of scope for this phase:** durable cross-crew orchestration with
suspend/resume; turn-level durability inside long agent steps.

### Phase 4 -- Future -- durable cross-crew orchestration

**Objective:** Pipelines survive process restarts — suspend/resume, fan-out from
a single trigger, human gates mid-pipeline — with coordination above the crew,
never inside it. Agentic orchestration (Level 3) becomes evaluable on a durable
substrate that is borrowed, not built.

**Capabilities:**

- Cross-crew orchestrator subscribing to `ready-for-*` events with explicit
  suspend/resume semantics; individual crews remain independently deployable.
- Turn-level durability inside long agent steps — step checkpointing so a
  mid-turn crash resumes without replaying completed tool work; adopt a
  maintained durable-execution engine rather than build bespoke (ADR-016).
- Park / resume for human gates — clarification and approval waits suspend
  durably when the work source supports async human reply.

**Quality gates:**

- A multi-hour implementation run resumes after a mid-turn crash without replaying
  completed tool work.
- A human approval gate suspends durably and resumes the same run, not a terminal escalation.
- Any Level 3 (model-generated plan) capability ships default-off and only for a
  specific workflow whose evals show it stays within bounds (ADR-015).

**Exit criteria:**

1. A cross-crew pipeline survives a process restart and resumes at the suspended step.
2. Turn-level durability research concludes with a borrow-or-build decision
   recorded as an ADR.

**Out of scope for this phase:** rebuilding any borrowed substrate by hand;
making model-generated orchestration the default for any crew.

## 4. Milestones

| Milestone                                                | Phase  | Customer-visible?   | Notes                                             |
| -------------------------------------------------------- | ------ | ------------------- | ------------------------------------------------- |
| Build crew runs unattended on real stories               | Now    | No (internal proof) | Now exit criteria met; gates Next opening         |
| Full delivery vertical (build → QA → review) operational | Next   | Yes                 | Handoffs auto-trigger; overnight run completes    |
| Eval framework gating every runtime change               | Next   | No                  | Eval gate in eval/release pipeline before unattended deploy |
| First CLI-shaped crew (code-reviewer) ships              | Next   | Yes                 | Requires the remote audit sink                    |
| Pro tier purchasable                                     | Later  | Yes                 | Pricing, licence enforcement, proof pack resolved |
| First optimiser (model selector) live                    | Later  | Yes (Pro)           | Measurable cost-quality win on the eval baseline  |
| Durable cross-crew pipeline resumes after restart        | Future | Yes                 | Coordination above the crew                       |

## 5. External dependencies

| Dependency                               | Owner squad                            | Gates                                        | Status                                     |
| ---------------------------------------- | -------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| npm registry (publish `@daddia/crew`)    | daddia                                 | Every crew's pinned dependency               | Available                                  |
| Container deployment topology            | daddia                                 | Server-shaped crew deploys                   | Validated                                  |
| Work source + VCS (live board for smoke) | daddia                                 | Now e2e exit criterion                       | Available                                  |
| Foundation model provider(s)             | daddia (vendor: model labs)            | Every persona run; routing in Later          | Available                                  |
| Durable-execution engine (when borrowed) | daddia (vendor: maintained dependency) | Future turn-level durability + orchestration | Deferred until a shipped workflow needs it |
| Telemetry warehouse + durable stream     | daddia                                 | Next exit criterion #4; eval read surface    | In progress                                |

## 6. Deferred beyond this cycle

- **Model-generated workflow plans (Level 3).** Default-off and eval-gated;
  returns only when a specific workflow proves it stays bounded
  ([`solution.md`](../architecture/solution.md) §5.6, ADR-015).
- **Single run across multiple repos / orgs / security boundaries.** One tenant
  per run is a permanent boundary ([`strategy.md`](strategy.md) §8).
- **Conversational multi-agent graphs.** Personas converge on artefacts, not messages.
- **Browser-based governance UI.** Steering happens in the systems of record.
- **Mandatory multi-reviewer change-advisory chains.** Crew respects configured
  bounds; it does not replace institutional approval processes.

## 7. Review cadence

- **Weekly:** the active backlog is checked against the current phase's exit criteria.
- **Pre-phase-gate:** update this document with evidence links before opening the
  next phase; confirm every exit criterion is met, not asserted.
- **Quarterly:** re-sequence Later / Future if the platform thesis or the
  substrate-borrow landscape shifts.
