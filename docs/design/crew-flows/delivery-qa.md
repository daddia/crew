# Delivery QA (`delivery-qa`)

```ts
/**
 * Run the delivery QA sequence for one story.
 *
 * Trigger:
 *   `ready-for-qa` event from delivery-build crew
 *   (also: scheduled polling of jira board for tickets in `in qa` as fallback)
 *
 * Sequence:
 *   → qa-engineer deploys MR branch to QA environment
 *   → qa-engineer runs automated suite (e2e, integration, regression against mocked externals)
 *   → qa-engineer runs exploratory / manual pass
 *   → qa-engineer runs external integration tests (e.g. payment sandbox, third-party APIs)
 *       → defects found:
 *           → qa-engineer documents defects as Jira comments
 *           → bounded defect loop (cap: QA_DEFECT_LOOP_CAP):
 *               → status update: `in qa` → `in remediation`
 *               → apply label: `qa-remediation`
 *               → emit `remediation-required` event (handoff signal to delivery-build crew)
 *               → HUMAN-IN-THE-LOOP PAUSE: await `ready-for-qa` event from delivery-build
 *                   → timeout: REMEDIATION_TIMEOUT_HOURS → emit `blocked` event, notify tech-lead → halt
 *               → re-run automated suite + targeted defect verification
 *           → cap exceeded → emit `blocked` event, notify tech-lead → halt
 *   → all checks pass, no defects outstanding
 *   → status update: `in qa` → `in review`
 *   → emit `ready-for-review` event (explicit handoff signal to delivery-review crew)
 *   → done
 *
 * Loop caps:
 *   QA_DEFECT_LOOP_CAP       - max remediation cycles before escalation
 *   REMEDIATION_TIMEOUT_HOURS - max wait for engineer remediation before escalation
 */
```
