---
type: Product Roadmap
scope: product
version: '1.1'
owner: daddia
status: Current
last_updated: 2026-05-21
related:
  - docs/product/product.md
  - architecture/solution.md
---

# Roadmap -- Crew

Phases follow [`product.md`](product.md) §2. Calendar dates are not committed; a phase opens when the previous phase exits cleanly. The architectural anchor for every phase is [`architecture/solution.md`](../../architecture/solution.md); the active backlog is in Jira.

## Now — prove delivery on the platform

**Outcome.** The `delivery-build` crew runs end-to-end on real Jira stories: context seed → clarification → implement → peer review → open MR → CI check → hand off for review. The build slice is the proof point that the substrate can carry the most demanding crew.

**Capabilities (shipped or in flight).**

| Capability | Where it lives |
|------------|----------------|
| Shared runtime (`@daddia/crew`) | `packages/crew` — `main`, `webhooks`, `config`, `state`, `workflow` subpaths |
| `delivery-build` crew | `crews/delivery-build` — engineer + senior-engineer; Jira poll + GitLab webhooks |
| `delivery-review` crew | Scaffolded as `crews/delivery-final-review` — full implementation deferred until build slice validates |
| `code-reviewer` crew (CLI-shaped) | Scaffolded as `crews/delivery-code-review` — full implementation deferred |
| Solution architecture | [`architecture/solution.md`](../../architecture/solution.md) |
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
- Commercial foundations: licence gating and the first surface of the managed control plane sketched.

**Exit criteria.**

1. Overnight run completes without operator intervention; morning report shows autonomy rate and cost per story.
2. Downstream crews pick up handoffs without manual re-trigger.
3. CrewBench baseline populated; cost-per-accepted-feature trend is visibly improving release over release.

## Later — open the catalogue

**Outcome.** Additional verticals on the same runtime. Each new crew is workflow + personas + prompts; the substrate is reused without modification.

**Candidates.**

- Documentation crew (release notes, changelog narration).
- Discovery crews (PM, Architect) feeding ready stories into delivery.
- Customer-issue triage crew.
- Full Pro-tier compounding surface: project memory, evaluation policy, model routing.

## Future — durable cross-crew orchestration

**Outcome.** Pipelines that survive process restarts: suspend / resume, fan-out from a single trigger, human gates mid-pipeline. Coordination lives above the crew, never inside it. The `Orchestrator` contract in `@daddia/crew` is the entry point; individual crews remain independently deployable.

See [`product.md`](product.md) §2 Future and [`architecture/solution.md`](../../architecture/solution.md) §1.1.

## Commercial release gate (Next → market)

- Pro tier purchasable; licence module validated end-to-end.
- CrewBench proof pack with documented wins and at least one documented loss.
- Cost-per-accepted-feature trend improving after runtime optimisations land.

## Review cadence

- **Per sprint:** Jira backlog against Now exit criteria.
- **Per phase gate:** update this document with evidence links.
- **Quarterly:** re-sequence Later / Future if the platform thesis shifts.
