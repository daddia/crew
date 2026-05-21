---
type: Architecture Decision Register
product: space
owner: Engineering
status: Current
last_updated: 2026-04-27
---

# Architecture Decision Register — Space

ADRs live in `architecture/decisions/` in this repo. Use the template at
`architecture/decisions/adr-template.md`. Target length 40–80 lines per ADR.

## Status legend

| Status         | Meaning                              |
| -------------- | ------------------------------------ |
| **Proposed**   | Under discussion, not yet adopted    |
| **Accepted**   | Adopted — the standard going forward |
| **Superseded** | Replaced by a later ADR              |
| **Rejected**   | Considered and not adopted           |

---

## Foundation decisions (Phase 1)

| ID                                               | Title                                                                  | Status   |
| ------------------------------------------------ | ---------------------------------------------------------------------- | -------- |
| [ADR-0001](ADR-0001-skill-delivery-mechanism.md) | Skill delivery mechanism: three-repo split with stripped public mirror | Accepted |

---

## Proposed (pending resolution)

Write the ADR before starting implementation of the blocking feature.

| ID  | Title | Priority | Blocks |
| --- | ----- | -------- | ------ |

---

## Adding a new ADR

```bash
cp architecture/decisions/adr-template.md architecture/decisions/ADR-{####}-{short-title}.md
```

1. Set status to `Proposed`. Open a PR for discussion.
2. On acceptance: update status to `Accepted`, add a row above.

**Placement rule**: Space monorepo decisions live here. Portfolio-level decisions (cross-cutting
Space and Crew) live in the portfolio delivery workspace at `crew-space:architecture/decisions/`.
