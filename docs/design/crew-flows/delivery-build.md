# Delivery Build (`delivery-build`)

Forward-looking contract for the build slice of the delivery vertical. Today's implementation: [`crews/delivery-build/`](../../../crews/delivery-build/).

```ts
/**
 * Run the delivery-build sequence for one story.
 *
 * Triggers:
 *   A) Scheduled polling of Jira for tickets in `to do` assigned to the engineer (primary)
 *   B) `POST /webhooks/jira` on issue-transitioned events (secondary)
 *
 * Scope: ticket → merge request → CI green → ticket transitioned to "In QA".
 *   The QA pass, final review, and merge are handled by downstream crews
 *   (`delivery-qa`, `delivery-review`).
 *
 * Sequence:
 *   → engineer seeds context: reads the Jira ticket + parent/epic, design.md if linked,
 *       and related artefacts
 *   → status update: `to do` → `in progress`
 *   → engineer assesses clarity; posts clarifying questions to Jira if required
 *       → ambiguous → status `clarification needed` (label: needs-clarification)
 *       → HUMAN-IN-THE-LOOP PAUSE: await product-owner/tech-lead response
 *           → timeout: CLARIFICATION_TIMEOUT_HOURS → escalate to tech-lead → halt
 *   → engineer implements story on a feature branch
 *   → engineer runs local toolchain (lint, types, unit tests) — fail fast before review
 *   → senior-engineer reviews diff on branch: design fidelity, simplicity, correctness
 *       → posts feedback as GitLab MR notes (or pre-MR comments on the branch)
 *   → engineer bounded address-feedback loop (cap: REFACTOR_LOOP_CAP)
 *       → cap exceeded → escalateToHumanReview, halt
 *   → engineer raises the merge request (senior review notes included in description)
 *   → CI monitor: poll the MR pipeline (cap: CI_RETRY_CAP attempts at engineer-led fix)
 *       → cap exceeded → escalateToHumanReview, halt
 *   → CI green
 *   → status update: `in progress` → `in qa`
 *   → emit `ready-for-qa` event {issueKey, mrUrl}
 *   → done
 *
 * Caps and timers:
 *   REFACTOR_LOOP_CAP           — max peer-review feedback/fix cycles before escalation
 *   CI_RETRY_CAP                — max CI fix attempts before escalation
 *   CLARIFICATION_TIMEOUT_HOURS — max wait for clarification response before escalation
 *
 * Failure handling:
 *   Every error path calls escalateToHumanReview (comment + transition to
 *   "Needs human review") and returns. The workflow never throws to the caller.
 */
```
