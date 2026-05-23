# Crew docs

The hierarchy of reference, in order: **Product strategy → Solution architecture → Roadmap → Backlog (Jira)**. Each artefact is one topic; everything below builds on what's above.

## Authoritative chain

| Layer | Document |
|-------|----------|
| Product strategy — what Crew is, why, for whom | [`product/product.md`](product/product.md) |
| Solution architecture — how Crew is built and operated | [`../architecture/solution.md`](../architecture/solution.md) |
| Roadmap — phases (Now / Next / Later / Future) and exit criteria | [`product/roadmap.md`](product/roadmap.md) |
| Product backlog — epic breakdown, dependencies, risks | [`product/backlog.md`](product/backlog.md) |
| Active story-level backlog | Jira (`CREW` project) |

## Supporting docs

| Area | Path | Supports |
|------|------|----------|
| Guiding principles | [`../architecture/principles.md`](../architecture/principles.md) | Design and operational constraints |
| Architectural decisions | [`../architecture/decisions/`](../architecture/decisions/) | The record of consequential decisions |
| Delivery approach | [`delivery/approach.md`](delivery/approach.md) | How artefact-led delivery maps to crews |
| Crew flow contracts | [`design/crew-flows/`](design/crew-flows/) | Per-crew sequences (forward-looking specs) |
| Runbooks | [`runbook/`](runbook/) | Operating deployed crews |
| Contributor guides | [`../contributing/`](../contributing/) | Authoring crews and personas in code |
| Code conventions | [`../AGENTS.md`](../AGENTS.md) | Current-state conventions for AI agents and humans |
| Research and ideas | [Confluence → 03 Research](https://carinyaparc.atlassian.net/wiki/spaces/CREW/pages/753668/03+Research) | Ideas, CrewBench (not in git) |
