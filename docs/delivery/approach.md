---
type: Delivery Approach
version: '1.4'
status: Current
last_updated: 2026-05-21
related:
  - docs/product/product.md
  - docs/product/roadmap.md
---

# Delivery approach

Supports [`product.md`](../product/product.md) and [`roadmap.md`](../product/roadmap.md). One sentence:

> Write enough down to reduce ambiguity before building, build by working the queue, and refine what you wrote based on what you learned.

## Five tracks (concurrent)

```
Strategy → Architecture → Discovery → Delivery → Refine
    ^______________________________________________|
```

| Track | Question | Repo artefacts |
|-------|----------|----------------|
| Strategy | What and why? | [`product/product.md`](../product/product.md), [`product/roadmap.md`](../product/roadmap.md) |
| Architecture | Is the structure sound? | [`architecture/solution.md`](../../architecture/solution.md), ADRs |
| Discovery | Ready to build? | Work-package requirements and `design.md` (when used) |
| Delivery | Done to standard? | Code, MR, review — crews in `crews/` |
| Refine | What did we learn? | Metrics, retros, doc updates |

Artefacts connect tracks — not message passing between agents. **Definition of Ready** gates Discovery → Delivery. **Definition of Done** gates Delivery → Refine. Discovery stays at least one sprint ahead of Delivery.

## Delivery crews (Now)

| Crew | Flow contract |
|------|---------------|
| `delivery-build` | [`design/crew-flows/delivery-build.md`](../design/crew-flows/delivery-build.md) |
| `delivery-qa` | [`design/crew-flows/delivery-qa.md`](../design/crew-flows/delivery-qa.md) |
| `delivery-review` | [`design/crew-flows/delivery-review.md`](../design/crew-flows/delivery-review.md) |

Authoring crews: [`contributing/`](../../contributing/). Runtime design: [`architecture/solution.md`](../../architecture/solution.md).
