---
type: Product Roadmap
scope: product
version: '1.3'
owner: daddia
status: Current
last_updated: 2026-06-26
related:
  - docs/product/strategy.md
  - docs/architecture/solution.md
---

# Roadmap -- Crew

Phases follow [`strategy.md`](strategy.md) §2. Calendar dates are not committed; a phase opens when the previous phase exits cleanly. The architectural anchor for every phase is [`solution.md`](../architecture/solution.md); the active story-level backlog is in Jira.

## Now — prove delivery on the platform

**Outcome.** The `delivery-build` crew runs end-to-end on real Jira stories: context seed → clarification → implement → peer review → open MR → CI check → hand off for review. The build slice is the proof point that the substrate can carry the most demanding crew.

**Capabilities (shipped or in flight).**

| Capability | Where it lives |
|------------|----------------|
| Shared runtime (`@daddia/crew`) | `packages/crew` — `main`, `webhooks`, `config`, `state`, `workflow` subpaths |
| `delivery-build` crew | `crews/delivery-build` — engineer + senior-engineer; Jira poll + GitLab webhooks |
| `delivery-review` crew | Scaffolded as `crews/delivery-final-review` — full implementation deferred until build slice validates |
| `code-reviewer` crew (CLI-shaped) | Scaffolded as `crews/delivery-code-review` — full implementation deferred |
| Solution architecture | [`solution.md`](../architecture/solution.md) |
| Build flow contract | [`docs/design/crew-flows/delivery-build.md`](../design/crew-flows/delivery-build.md) |

**Exit criteria.**

1. Diagnostics, cost-per-run logging, `/healthz`, runbook, and an e2e smoke against a real Jira board + GitLab project all in place.
2. Three or more stories reach the hand-off step via the autonomous path (poll or webhook), with provenance recorded per run.
3. Escalation paths verified: loop cap, clarification timeout, and agent failure all surface to humans without crashing the server.

## Next — harden the runtime; close the delivery loop

**Outcome.** Safe to run unattended overnight: predictable recovery, observable cost and quality, operational runbooks for every deployed crew. The delivery vertical is complete (build → QA → review) and the compounding wedge — cost per accepted artefact trending down, recall trending up — is measurable.

**Capabilities.**

- Crash recovery and in-flight story detection documented, tested, and consistent across all delivery crews.
- Structured cost-per-run logging with alerting on failure rate and cost drift.
- `delivery-qa` and `delivery-review` crews operational; handoff events (`ready-for-qa`, `ready-for-review`) wired.
- OTel tracing across crews.
- First CLI-shaped crew (`code-reviewer`) ships — requires the remote audit sink (`@daddia/crew/audit`).
- **Authoring ergonomics.** `crew init` scaffolds a server- or CLI-shaped crew from a template; canonical persona layout (`plugin/` for skills and subagents); runtime docs bundled inside `@daddia/crew` for agent-local consumption; `guard:invariants` enforces AGENTS.md rules in CI.
- **CrewBench and `crew eval`.** Fixture-owned evals per crew assert session success, tool usage, and escalation paths against the same HTTP/CLI surface production uses; gate vs soft assertions; baseline populated before prompt or harness changes ship unattended.
- **Harness hardening.** Progressive skill loading (descriptions always on, bodies on demand); context compaction before window overflow on long implementation runs; structured `outputSchema` on task-mode steps where verdicts must be machine-parseable.
- **Security model (shipped).** [`security-model.md`](../architecture/security-model.md) — runtime vs workspace vs MCP trust boundaries; pre-production checklist in [`delivery-build` runbook](../runbook/delivery-build.md) §7 for webhook verification, allowlists, and untrusted-input fencing.
- **Operator visibility.** Run stream or equivalent live progress surface for overnight batches; subagent runs correlated to parent story in audit.
- **Outcome telemetry wired.** GitLab merge/revert webhooks and Jira story-reopen events captured and attributed to originating runs. `model_id`, `task_type`, and `escalation_cause` taxonomy added to the audit hook. Every run from this point is a data point the optimisation layer will learn from. See [CrewTelemetry](https://carinyaparc.atlassian.net/wiki/spaces/CREW/pages/1671200) (Confluence research).
- **Event stream infrastructure.** Single-emission OTel-compliant events, durable stream (RabbitMQ or equivalent), fan-out to Honeycomb (filtered, runtime health) and a data warehouse (full payload — Postgres + JSONB to start). The warehouse is the shared read surface for CrewBench, the future optimisation layer, and any downstream consumer.
- Commercial foundations: licence gating and the first surface of the managed control plane sketched.

**Exit criteria.**

1. Overnight run completes without operator intervention; morning report shows autonomy rate and cost per story.
2. Downstream crews pick up handoffs without manual re-trigger.
3. CrewBench baseline populated; cost-per-accepted-feature trend is visibly improving release over release.
4. Outcome telemetry pipeline operational: a completed story's run can be joined to its MR outcome and its cost breakdown in a single warehouse query.
5. At least one fixture-owned eval per deployed crew runs in CI; a prompt or harness regression fails the build before merge.
6. A new crew can be scaffolded with `crew init` and reach a passing smoke eval without copying an existing crew by hand.

## Later — open the catalogue

**Outcome.** Additional verticals on the same runtime. Each new crew is workflow + personas + prompts; the substrate is reused without modification.

**Candidates.**

- Documentation crew (release notes, changelog narration).
- Discovery crews (PM, Architect) feeding ready stories into delivery.
- Customer-issue triage crew.
- Full Pro-tier compounding surface: project memory, evaluation policy, model routing.
- **First optimiser ships** — model selector, as the highest-leverage specialist. Pro-tier value proposition with a measurable outcome. See [CrewOptimiser](https://carinyaparc.atlassian.net/wiki/spaces/CREW/pages/1703940) (Confluence research).
- **Ingress conventions.** Generalise webhook handlers into a channel adapter pattern (HTTP, Slack, scheduled triggers) without coupling crews to a single work source.
- **Scheduled-batch topology.** Cron-authored schedules as first-class crew files, compiled to the host's scheduler — same audit and escalation guarantees as server-shaped crews.
- **Optional execution isolation.** Sandbox or container-backed workspace for catalogue crews that operate on untrusted or forked code; credential brokering keeps secrets out of the model-visible environment.
- **Dynamic policy (local tier).** Per-project or per-tenant skill and prompt resolution in config — seed of the Pro control plane without requiring managed infrastructure.

## Future — durable cross-crew orchestration

**Outcome.** Pipelines that survive process restarts: suspend / resume, fan-out from a single trigger, human gates mid-pipeline. Coordination lives above the crew, never inside it. The `Orchestrator` contract in `@daddia/crew` is the entry point; individual crews remain independently deployable.

**Capabilities (research before build).**

- **Turn-level durability inside long agent steps.** Story-level SQLite recovery is necessary but not sufficient for multi-hour implementation runs; evaluate step checkpointing inside a single persona session so mid-turn crashes resume without replaying completed tool work.
- **Park / resume for human gates.** Clarification and approval waits suspend durably (not only timeout-and-escalate) when the work source supports async human reply.
- **Composition layer** subscribing to `ready-for-*` events with explicit suspend/resume semantics.

See [`strategy.md`](strategy.md) §2 Future and [`solution.md`](../architecture/solution.md) §1.1.

## Commercial release gate (Next → market)

The following must be resolved before the Pro tier is purchasable:

- **Pricing model.** Per-crew, per-run, per-accepted-artefact, or seat-based. Pricing must align with the value metric customers understand (cost per accepted artefact) and the platform metric Crew controls (routing, memory, evaluation).
- **Free vs. Pro boundary.** Every crew runs end-to-end on local-only config (free tier). The Pro tier adds compounding capabilities — memory, evidence, evaluation policy, model routing — that reduce cost and improve quality with use. The boundary must be clear to both customers and agents.
- **Licence enforcement.** Licence key provisioning, validation at session start, degradation behaviour on expiry or unreachability.
- **CrewBench proof pack.** Documented wins and at least one documented loss. Cost-per-accepted-feature trend improving after runtime optimisations.
- **Control-plane availability.** SLO defined and tested. Every control-plane call degrades to local on unreachability — this must be proven, not assumed.

## Review cadence

- **Per sprint:** Jira backlog against Now exit criteria.
- **Per phase gate:** update this document with evidence links.
- **Quarterly:** re-sequence Later / Future if the platform thesis shifts.
