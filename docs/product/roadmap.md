---
type: Product Roadmap
scope: product
version: '1.0'
owner: daddia
status: Current
last_updated: 2026-05-21
related:
  - docs/product/product.md
  - architecture/solution.md
---

# Roadmap -- Crew

Phases follow [`product.md`](product.md) §2. Calendar dates are not committed; a phase opens when the previous phase exits cleanly.

**Active delivery work** is tracked in [`backlog.md`](backlog.md) (delivery-build slice, CREW-67). **Historical epic backlog** from the prior planning model lives in [`archive/epic-backlog-2026-05.md`](archive/epic-backlog-2026-05.md) — superseded by the multi-crew platform design; retained for traceability only.

## Now — prove delivery on the platform

**Outcome.** The `delivery-build` crew runs end-to-end on real Jira stories: context seed → clarification → implement → peer review → open MR → CI check → hand off to QA (`In QA`). Success: at least three stories complete the build sequence without manual CLI intervention between steps.

**Architecture (shipped or in flight).**

| Capability | Where it lives |
|---|---|
| Shared runtime (`@daddia/crew`) | `packages/crew` — state, workflow engine, webhooks, config |
| `delivery-build` crew | `crews/delivery-build` — engineer + senior-engineer; Jira poll + GitLab webhooks |
| `delivery-qa` / `delivery-review` | Scaffolded; fast-follow after build slice validates |
| Solution architecture | [`architecture/solution.md`](../../architecture/solution.md) |
| Build flow contract | [`docs/crew-flows/delivery-build.md`](../crew-flows/delivery-build.md) |

**Exit criteria.**

1. CREW-67 complete: diagnostics, cost logging, `/healthz`, runbook, and e2e smoke against a real Jira board + GitLab project.
2. Three or more stories reach `In QA` via the autonomous path (webhook or poll), with provenance recorded per run.
3. Escalation paths verified: loop cap, clarification timeout, and agent failure all surface to humans without crashing the server.

## Next — harden the runtime

**Outcome.** Safe to run unattended overnight: predictable recovery, observable cost and quality, operational runbooks.

**Capabilities.**

- Crash recovery and in-flight story detection documented and tested.
- Structured cost-per-run logging and alerting on failure rate.
- `delivery-qa` and `delivery-review` crews operational; handoff events (`ready-for-review`, etc.) wired.
- OTel tracing (if prioritised) across crews.
- Commercial foundations: licence gating, control-plane API sketch (see [IDEA-015 Phase 2 Architecture](https://carinyaparc.atlassian.net/wiki/spaces/CREW/pages/622617/IDEA-015+Phase+2+Architecture+Evolution+Managed+Control+Plane) in Confluence Research).

**Exit criteria.**

1. Overnight run completes without operator intervention; morning report shows autonomy rate and cost per story.
2. Downstream crews pick up handoffs without manual re-trigger.
3. CrewBench baseline row populated (see [`proof.md`](proof.md)).

## Later — new crews and Discovery track

**Outcome.** Additional crews on the same runtime; optional Discovery personas (PM, Architect) feeding ready stories into Delivery.

**Capabilities.**

- Second vertical crew (e.g. code review CLI or docs crew).
- Discovery workflows on the shared `WorkflowEngine` / plan model.
- Persona cadence for full squad — [`persona-cadence.md`](persona-cadence.md) (Discovery/Refine sections apply here).

## Future — cross-crew orchestration

**Outcome.** Durable pipelines across crews: suspend/resume, fan-out, human gates mid-pipeline. Uses the `Orchestrator` contract in `@daddia/crew` without coupling individual crews.

See [`product.md`](product.md) §2 Future and [`architecture/solution.md`](../../architecture/solution.md) §1.1.

## Commercial release gate (Next → market)

From [`commercial.md`](commercial.md) and [`proof.md`](proof.md):

- Pro tier purchasable; licence module validated.
- CrewBench proof pack with documented wins and at least one documented loss.
- Cost-per-accepted-feature trend improving after runtime optimisations land.

## Review cadence

- **Per sprint:** [`backlog.md`](backlog.md) against Now exit criteria.
- **Per phase gate:** update this document with evidence links.
- **Quarterly:** re-sequence Later/Future if platform thesis shifts.
