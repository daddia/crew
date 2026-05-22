# Delivery Final Review Crew (`delivery-final-review`)

> **Scaffold** — implements the planned `delivery-review` flow contract. The folder name will be rationalised to `delivery-review` once the implementation is live; until then, the contract in [`docs/design/crew-flows/delivery-review.md`](../../docs/design/crew-flows/delivery-review.md) and the catalogue in [`architecture/solution.md`](../../architecture/solution.md) refer to it as `delivery-review`.

The final review and merge crew runs after `delivery-qa` has emitted a `ready-for-review` event. It is the last stop before code lands on `main`.

## Planned scope

1. Triggered by a `ready-for-review` event from `delivery-qa` (or by polling for tickets in "In Review").
2. `tech-lead` performs a final code review (architecture, cross-cutting concerns, technical AC).
3. Human-in-the-loop pause: awaits product-manager stakeholder review (functional AC sign-off; blocking).
4. With both approvals confirmed, `tech-lead` approves the MR and merges to main.
5. Jira ticket transitioned to "Done"; a review summary is posted on the ticket.

## Status

| Component | Status |
|-----------|--------|
| `src/workflow.ts` | Stubbed — throws `not yet implemented` |
| `src/state.ts` | Scaffolded with the planned `Step` union |
| `src/index.ts` | Scaffolded (`/healthz` only; no handlers wired) |
| Personas | Not yet added |
| Webhook handler | Not yet added |

## Running locally

```bash
cp .env.example .env
# fill in values

cd ../../          # workspace root
pnpm install && pnpm build

cd crews/delivery-final-review
pnpm start
```

`/healthz` will respond `{"ok": true}`; no workflow logic runs yet.
