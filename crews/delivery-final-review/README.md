# Delivery Final Review Crew (`delivery-final-review`)

> **Scaffold** — full implementation follows the `delivery-build` proof of concept.

The delivery-review crew runs the final review and merge sequence for a story after `delivery-build` has completed peer review and emitted a `ready-for-review` event.

## What it will do

1. Triggered by a `ready-for-review` event from `delivery-build` (or by polling for tickets in "In Review").
2. `tech-lead` performs a final code review (architecture, cross-cutting concerns, technical AC).
3. Human-in-the-loop pause: awaits product-manager stakeholder review (functional AC sign-off).
4. With both approvals confirmed, `tech-lead` approves the MR and merges to main.
5. Jira ticket transitioned to "Done".

## Status

| Component         | Status                                 |
| ----------------- | -------------------------------------- |
| `src/workflow.ts` | Stubbed — throws `not yet implemented` |
| `src/state.ts`    | Scaffolded                             |
| `src/index.ts`    | Scaffolded (healthz only)              |
| Agents            | Not yet added                          |
| Webhook handler   | Not yet added                          |

## Running locally

```bash
cp .env.example .env
# fill in values

cd ../../         # workspace root
pnpm install && pnpm build

cd crews/delivery-review
pnpm start
```
