# Delivery Review (`delivery-review`)

```ts
/**
 * Run the delivery review sequence for one story.
 *
 * Trigger:
 *   `ready-for-review` event from delivery-qa crew
 *   (also: scheduled polling of jira board for tickets in `in review` as fallback)
 *
 * Sequence:
 *   → tech-lead final-code-review (architecture + cross-cutting gate + technical AC validation)
 *   → HUMAN-IN-THE-LOOP PAUSE: await product-manager stakeholder-review
 *       (functional AC validation; PM approval is blocking — merge cannot proceed without sign-off)
 *       → timeout: PM_REVIEW_TIMEOUT_HOURS → escalate to delivery-lead → halt
 *   → both approvals confirmed (tech-lead + product-manager)
 *   → tech-lead approves MR and merges to main
 *   → tech-lead updates Jira ticket, adds review summary comment
 *   → status update: `in review` → `done`
 *   → done
 *
 * Design notes:
 *   - By this point the MR branch is CI green and QA validated; tech-lead review is an
 *     architecture + AC gate only, not a defect-finding exercise
 *   - PM review is serial and blocking; merge cannot proceed without explicit PM sign-off
 *   - Four-eyes merge policy not enforced at this crew boundary (tech-lead reviews AND merges);
 *     promote to separate approver/merger roles if policy requires separation of duties
 *   - PM_REVIEW_TIMEOUT_HOURS should reflect team SLA for stakeholder availability
 */
```
