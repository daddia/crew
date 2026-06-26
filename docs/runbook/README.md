---
type: Runbooks
status: Current
last_updated: 2026-05-21
related:
  - docs/product/strategy.md
  - docs/product/roadmap.md
---

# Operating crews

Step-by-step procedures for running deployed crews. Supports [`roadmap.md`](../product/roadmap.md) (Next: unattended operation). The runtime contract these runbooks operate against lives in [`../architecture/solution.md`](../architecture/solution.md).

## Operating model

| Rule                    | Meaning                                                |
| ----------------------- | ------------------------------------------------------ |
| One process per crew    | Scale out = more containers, not more threads          |
| Fire-and-forget ingress | Webhooks return `200`; the workflow runs async         |
| Escalation, not throw   | Loop cap / failure → human review in Jira, then return |

```text
delivery-build  ──(In QA)──►  delivery-qa  ──(In Review)──►  delivery-review
```

Handoffs are encoded as work-source state transitions plus `ready-for-*` events. Per-crew sequences: [`../design/crew-flows/`](../design/crew-flows/).

## Pre-deploy checklist (server-shaped crews)

1. Crew env from `crews/{name}/.env.example`.
2. `pnpm diagnose` from the crew folder — all checks pass.
3. Jira transitions match the crew's flow contract.
4. Image installs `@daddia/crew` from npm (not workspace).
5. Security checklist complete — see [`architecture/security-model.md`](../architecture/security-model.md) and the per-crew runbook (e.g. [delivery-build.md §7](delivery-build.md#7-pre-production-security-checklist)).

## Runbooks

| Topic                         | Document                               |
| ----------------------------- | -------------------------------------- |
| `delivery-build` operations   | [delivery-build.md](delivery-build.md) |
| `delivery-qa` operations      | [delivery-qa.md](delivery-qa.md)       |
| Local container build + smoke | [container.md](container.md)           |
| Publishing `@daddia/crew`     | [publish.md](publish.md)               |

Additional runbooks (`delivery-review`) land alongside that crew — see [`../product/roadmap.md`](../product/roadmap.md).
