# Delivery Review (`delivery-review`)

Forward-looking contract for the final-review slice. Implemented in [`crews/delivery-review/`](../../../crews/delivery-review/).

```ts
/**
 * Run the delivery-review sequence for one story.
 *
 * Trigger:
 *   A) Jira webhook — transition to `In Review` (primary)
 *   B) Poller JQL — tickets in `In Review` assigned to the review bot (fallback)
 *   (Upstream `delivery-qa` emits `workflow.handoff-to-review` for observability;
 *    this crew does not subscribe to log events — Jira state is the handoff.)
 *
 * Scope: QA-validated MR → context-seed → tech-lead final code review →
 *   PM stakeholder HITL pause → deterministic GitLab approve + merge →
 *   Jira transition to "Done" → review summary on Jira (best-effort).
 *
 * Sequence:
 *   → context-seed (Jira AC + MR resolution; CI-green guard)
 *   → tech-lead final-code-review (architecture, cross-cutting, technical AC)
 *   → stakeholder-review-pending (HITL PAUSE: await human PM sign-off via Jira
 *       comment `/pm-approve` from an allowlisted account; review summary cached
 *       to {DB_PATH}.review-artefacts.json for merge resume)
 *       → timeout: PM_REVIEW_TIMEOUT_HOURS → escalateToHumanReview, halt
 *   → merge-and-close (workflow integration layer: approve + merge MR — not on
 *       the review-task tool allowlist)
 *   → status update: `In Review` → `Done`
 *   → log workflow.handoff-done { issueKey, mrUrl, mergeCommitSha }
 *   → tech-lead publish-review-summary (Jira comment; best-effort after Done)
 *   → done
 *
 * Caps and timers:
 *   PM_REVIEW_TIMEOUT_HOURS — max wait for PM stakeholder review before escalation
 *
 * Design notes:
 *   - By this point the MR branch is CI-green and QA-validated; tech-lead
 *     review is an architecture + AC gate, not a defect-finding exercise.
 *   - PM review is serial and blocking; merge cannot proceed without explicit
 *     human PM sign-off (no `product-manager` agent persona in v1).
 *   - Four-eyes merge policy is NOT enforced at this crew boundary (tech-lead
 *     reviews; workflow merges deterministically after both gates pass); promote
 *     to separate approver / merger personas if policy requires separation of duties.
 *   - PM_REVIEW_TIMEOUT_HOURS should reflect the team SLA for stakeholder
 *     availability.
 *
 * Failure handling: same contract as every crew — escalateToHumanReview on
 * unrecoverable failure; the workflow does not throw to the caller.
 */
```
