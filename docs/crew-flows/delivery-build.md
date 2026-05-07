# Delivery Build

```ts
/**
 * Run the delivery build sequence for one story.
 *
 * Triggers:
 *   A) Scheduled polling of Jira board for assigned tickets (`to do` + assigned to engineer)
 *   B) Scheduled polling for clarification-pending tickets where a human has responded
 *
 * Scope: ticket → merge request (ready for review)
 *   MR feedback, CI, and final stakeholder review are handled by downstream crews
 *   (delivery-code-review, delivery-final-review).
 *
 * Sequence:
 *   → engineer seeds context: reads Jira ticket + parent/epic (if present),
 *       design.md, and related artefacts
 *   → status update: `to do` → `in progress`
 *   → engineer assesses clarity; posts clarifying questions to Jira if required
 *       → ambiguous → status `blocked` (label: needs-clarification)
 *       → HUMAN-IN-THE-LOOP PAUSE: await product-owner/tech-lead response
 *           → timeout: CLARIFICATION_TIMEOUT_HOURS → escalate to tech-lead → halt
 *   → engineer implements story on branch
 *   → engineer runs local toolchain (lint, types, unit tests) — fail fast before review
 *   → senior-engineer reviews diff on branch: design fidelity, simplicity, correctness
 *       → posts feedback to GitLab MR comments or Jira ticket
 *   → engineer bounded address-feedback loop (cap: REFACTOR_LOOP_CAP)
 *       → cap exceeded → status `blocked` (label: needs-tech-lead) → halt
 *   → engineer raises merge request (senior review notes included in description)
 *   → status update: `in progress` → `ready for review`
 *   → emit `ready-for-review` event {issueKey, mrUrl}
 *   → done
 *
 * Loop caps:
 *   REFACTOR_LOOP_CAP           - max peer-review feedback/fix cycles before escalation
 *   CLARIFICATION_TIMEOUT_HOURS - max wait for clarification response before escalation
 */
```
