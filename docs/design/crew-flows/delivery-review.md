# Delivery Review (`delivery-review`)

Forward-looking contract for the final-review slice. Scaffolded in code as [`crews/delivery-final-review/`](../../../crews/delivery-final-review/) — the folder will be renamed to `delivery-review` once the implementation is live.

```ts
/**
 * Run the delivery-review sequence for one story.
 *
 * Trigger:
 *   A) `ready-for-review` event from delivery-qa (primary)
 *   B) Scheduled polling of Jira for tickets in `in review` (fallback)
 *
 * Scope: QA-validated MR → tech-lead final code review → PM stakeholder
 *   review → merge to main → ticket transitioned to "Done".
 *
 * Sequence:
 *   → tech-lead final-code-review (architecture, cross-cutting, technical AC)
 *   → HUMAN-IN-THE-LOOP PAUSE: await product-manager stakeholder review
 *       (functional AC validation; PM approval is blocking — merge cannot proceed without it)
 *       → timeout: PM_REVIEW_TIMEOUT_HOURS → escalateToHumanReview, halt
 *   → both approvals confirmed (tech-lead + product-manager)
 *   → tech-lead approves the MR and merges to main
 *   → tech-lead updates the Jira ticket with a review summary
 *   → status update: `in review` → `done`
 *   → done
 *
 * Caps and timers:
 *   PM_REVIEW_TIMEOUT_HOURS — max wait for PM stakeholder review before escalation
 *
 * Design notes:
 *   - By this point the MR branch is CI-green and QA-validated; tech-lead
 *     review is an architecture + AC gate, not a defect-finding exercise.
 *   - PM review is serial and blocking; merge cannot proceed without explicit
 *     PM sign-off.
 *   - Four-eyes merge policy is NOT enforced at this crew boundary (tech-lead
 *     reviews AND merges); promote to separate approver / merger personas if
 *     policy requires separation of duties.
 *   - PM_REVIEW_TIMEOUT_HOURS should reflect the team SLA for stakeholder
 *     availability.
 *
 * Failure handling: same contract as every crew — escalateToHumanReview on
 * unrecoverable failure; the workflow does not throw to the caller.
 */
```
