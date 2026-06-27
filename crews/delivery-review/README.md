# Delivery Review Crew (`delivery-review`)

Terminal crew in the delivery vertical. Picks up QA-validated, CI-green MRs in Jira **In Review**,
runs tech-lead final review, pauses for human PM sign-off, merges to `main`, and transitions the
story to **Done**.

Authoritative spec:
[`docs/work/06-delivery-review/design.md`](../../docs/work/06-delivery-review/design.md) ·
[`docs/design/crew-flows/delivery-review.md`](../../docs/design/crew-flows/delivery-review.md)

## Triggers

1. **Primary:** Jira webhook — transition to **In Review**
2. **Fallback:** Poller JQL — `status = "In Review"` assigned to the review bot

Upstream `delivery-qa` logs `workflow.handoff-to-review` for observability. This crew does **not**
subscribe to log events — Jira state is the handoff.

## Workflow

1. `context-seed` — resolve MR, assert CI green
2. `tech-lead` `final-code-review` — architecture + technical AC gate (read-only tools)
3. `stakeholder-review-pending` — HITL pause; PM replies with `/pm-approve` from an allowlisted account
4. `merge-and-close` — workflow integration layer approves + merges MR (not on agent allowlist)
5. `tech-lead` `publish-review-summary` — Jira comment (best-effort after **Done** transition)

PM sign-off is human-only in v1 — no `product-manager` agent persona.

## Ports

| Crew              | Default `PORT` |
| ----------------- | -------------- |
| `delivery-build`  | 3000           |
| `delivery-qa`     | 3001           |
| `delivery-review` | 3002           |

## Running locally

```bash
cp .env.example .env
# fill in values

cd ../../          # workspace root
pnpm install && pnpm build

cd crews/delivery-review
pnpm start
```

`/healthz` responds `{"ok": true}`. See [`docs/runbook/delivery-review.md`](../../docs/runbook/delivery-review.md)
for deploy, PM approval, and escalation playbooks.
