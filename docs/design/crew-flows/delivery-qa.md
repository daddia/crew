# Delivery QA (`delivery-qa`)

Forward-looking contract. Not yet scaffolded in code. Planned for the Next phase — see [`../../product/roadmap.md`](../../product/roadmap.md).

```ts
/**
 * Run the delivery-qa sequence for one story.
 *
 * Trigger:
 *   A) `ready-for-qa` event from delivery-build (primary)
 *   B) Scheduled polling of Jira for tickets in `in qa` (fallback)
 *
 * Scope: MR is CI-green and assigned to QA → defect-free QA pass → ticket
 *   transitioned to "In Review". Code review and merge are handled by
 *   delivery-review.
 *
 * Sequence:
 *   → qa-engineer deploys the MR branch to the QA environment
 *   → qa-engineer runs the automated suite (e2e, integration, regression against mocked externals)
 *   → qa-engineer runs an exploratory / manual pass
 *   → qa-engineer runs external integration tests (e.g. payment sandbox, third-party APIs)
 *       → defects found:
 *           → qa-engineer documents defects as Jira comments
 *           → bounded defect loop (cap: QA_DEFECT_LOOP_CAP):
 *               → status update: `in qa` → `in remediation`
 *               → apply label: `qa-remediation`
 *               → emit `remediation-required` event (handoff to delivery-build)
 *               → HUMAN-IN-THE-LOOP PAUSE: await `ready-for-qa` event from delivery-build
 *                   → timeout: REMEDIATION_TIMEOUT_HOURS → escalateToHumanReview, halt
 *               → re-run automated suite + targeted defect verification
 *           → cap exceeded → escalateToHumanReview, halt
 *   → all checks pass, no defects outstanding
 *   → status update: `in qa` → `in review`
 *   → emit `ready-for-review` event (handoff to delivery-review)
 *   → done
 *
 * Caps and timers:
 *   QA_DEFECT_LOOP_CAP        — max remediation cycles before escalation
 *   REMEDIATION_TIMEOUT_HOURS — max wait for engineer remediation before escalation
 *
 * Failure handling: same contract as every crew — escalateToHumanReview on
 * unrecoverable failure; the workflow does not throw to the caller.
 */
```
