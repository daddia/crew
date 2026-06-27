---
type: Delivery Approach
version: '1.5'
status: Current
last_updated: 2026-05-21
related:
  - docs/product/strategy.md
  - docs/product/roadmap.md
---

# Delivery approach

How work flows from strategy to merge inside Crew. Supports [`strategy.md`](../product/strategy.md) and [`roadmap.md`](../product/roadmap.md). One sentence:

> Write enough down to reduce ambiguity before building, build by working the queue, and refine what you wrote based on what you learned.

## Five tracks (concurrent)

```text
Strategy → Architecture → Discovery → Delivery → Refine
    ^______________________________________________|
```

| Track        | Question                | Repo artefacts                                                                                                                       |
| ------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Strategy     | What and why?           | [`product/strategy.md`](../product/strategy.md), [`product/roadmap.md`](../product/roadmap.md)                                       |
| Architecture | Is the structure sound? | [`architecture/solution.md`](../../architecture/solution.md), [`architecture/principles.md`](../../architecture/principles.md), ADRs |
| Discovery    | Ready to build?         | Work-package requirements and `design.md` (when used)                                                                                |
| Delivery     | Done to standard?       | Code, MR, review — crews in [`crews/`](../../crews/)                                                                                 |
| Refine       | What did we learn?      | Metrics, retros, doc updates                                                                                                         |

Artefacts connect tracks — not message passing between agents. **Definition of Ready** gates Discovery → Delivery. **Definition of Done** gates Delivery → Refine. Discovery stays at least one sprint ahead of Delivery.

## Delivery vertical (today and planned)

| Crew (planned name) | Flow contract                                                                     | Status                                 |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| `delivery-build`    | [`design/crew-flows/delivery-build.md`](../design/crew-flows/delivery-build.md)   | Implemented                            |
| `delivery-qa`       | [`design/crew-flows/delivery-qa.md`](../design/crew-flows/delivery-qa.md)         | Planned (Next phase)                   |
| `delivery-review`   | [`design/crew-flows/delivery-review.md`](../design/crew-flows/delivery-review.md) | Scaffolded as `crews/delivery-review/` |

A standalone `code-reviewer` crew (CLI-shaped, post-MR) is sketched in [`architecture/solution.md`](../../architecture/solution.md) §4.1 and scaffolded as `crews/delivery-code-review/`; the full implementation lands when the remote audit sink (`@daddia/crew/audit`) is in place.

Authoring crews and personas in code: [`contributing/`](../../contributing/). Runtime design and topology contract: [`architecture/solution.md`](../../architecture/solution.md).
