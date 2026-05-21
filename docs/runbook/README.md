---
type: Runbooks
status: Current
last_updated: 2026-05-21
related:
  - docs/product/product.md
  - docs/product/roadmap.md
---

# Operating crews

Supports [`roadmap.md`](../product/roadmap.md) (Next: unattended operation). Step-by-step procedures live in this folder.

## Operating model

| Rule | Meaning |
|------|---------|
| One process per crew | Scale out = more containers, not more threads |
| Fire-and-forget ingress | Webhooks return `200`, workflow runs async |
| Escalation, not throw | Loop cap / failure → human review in Jira, return |

```text
delivery-build  ──(In QA)──►  delivery-qa  ──(In Review)──►  delivery-review
```

Handoffs: work-source state + `ready-for-*` events. Sequences: [`design/crew-flows/`](../design/crew-flows/).

## Before deploy

1. Env from crew `.env.example`
2. `pnpm diagnose` — all checks pass
3. Jira transitions match flow contract
4. Image uses `@daddia/crew` from npm (not workspace)

## Runbooks

| Topic | Document |
|-------|----------|
| `delivery-build` | [delivery-build.md](delivery-build.md) |
| Container smoke | [container.md](container.md) |
| Publish `@daddia/crew` | [publish.md](publish.md) |

Runtime detail: [`architecture/solution.md`](../../architecture/solution.md).
