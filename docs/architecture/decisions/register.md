---
type: Architecture Decision Register
product: crew
owner: daddia
status: Current
last_updated: 2026-06-26
---

# Architecture Decision Register — Crew

ADRs live in [`docs/architecture/decisions/`](.) in this repo. Use the template at
[`adr-template.md`](adr-template.md). Target length 40–80 lines per ADR. Candidate decisions inferred from the current codebase are listed in [`../solution.md`](../solution.md) §9 — they graduate to this register when contested, revisited, or about to be revised.

## Status legend

| Status         | Meaning                              |
| -------------- | ------------------------------------ |
| **Proposed**   | Under discussion, not yet adopted    |
| **Accepted**   | Adopted — the standard going forward |
| **Superseded** | Replaced by a later ADR              |
| **Rejected**   | Considered and not adopted           |

---

## Foundation decisions

| ID       | Title                           | Status   |
| -------- | ------------------------------- | -------- |
| ADR-0002 | Work storage and issue tracking | Accepted |

---

## Proposed (pending resolution)

Write the ADR before starting implementation of the blocking feature.

| ID       | Title                                           | Priority | Blocks                                                      |
| -------- | ----------------------------------------------- | -------- | ----------------------------------------------------------- |
| ADR-0001 | Turn-level checkpointing for in-run tool replay | P1       | CREW-20 implementation; informs CREW-13 orchestrator design |

---

## Adding a new ADR

```bash
cp docs/architecture/decisions/adr-template.md docs/architecture/decisions/ADR-{####}-{short-title}.md
```

1. Set status to `Proposed`. Open a PR for discussion.
2. On acceptance: update status to `Accepted`, add a row above.

**Placement rule:** Runtime and crew-specific decisions live in this repo (`docs/architecture/decisions/`). Product strategy and roadmap live in `docs/product/`; active backlog in Jira.
