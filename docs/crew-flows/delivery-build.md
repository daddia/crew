# Delivery Build

```ts
/**
 * Run the delivery build sequence for one story.
 *
 * Triggers:
 *   A) scheduled polling of jira board for assigned tickets (`to do` + assigned to engineer)
 *   B) scheduled polling of jira board for tickets (`in remediation` + label: `qa-remediation`)
 *       → scoped re-entry: skip to remediation sub-sequence
 *
 * Sequence (full):
 *   → engineer reads jira ticket, design docs and other references → seeds memory and context
 *   → engineer posts clarifying questions to Jira comments (if required)
 *       → HUMAN-IN-THE-LOOP PAUSE: await product-owner/tech-lead response
 *           → timeout: CLARIFICATION_TIMEOUT_HOURS → escalate to tech-lead + emit `blocked` event → halt
 *   → status update: `to do` → `in progress`
 *   → engineer implements story on branch
 *   → engineer runs locally and validates
 *   → senior-engineer peer-code-review: checks out branch, runs locally, posts feedback
 *   → engineer bounded address-feedback loop (cap: REFACTOR_LOOP_CAP)
 *       → cap exceeded → emit `blocked` event, notify tech-lead → halt
 *   → engineer raises merge request
 *   → engineer monitors CI
 *   → engineer bounded CI fix loop (cap: CI_RETRY_CAP; exit condition: CI green)
 *       → cap exceeded → emit `blocked` event, notify tech-lead → halt
 *   → status update: `in progress` → `in qa`
 *   → emit `ready-for-qa` event (explicit handoff signal to delivery-qa crew)
 *   → done
 *
 * Sequence (remediation re-entry):
 *   → engineer reads QA defect notes from Jira comments
 *   → engineer fixes defects on branch
 *   → engineer bounded CI fix loop (cap: CI_RETRY_CAP; exit condition: CI green)
 *       → cap exceeded → emit `blocked` event, notify tech-lead → halt
 *   → remove label: `qa-remediation`
 *   → status update: `in remediation` → `in qa`
 *   → emit `ready-for-qa` event
 *   → done
 *
 * Loop caps:
 *   REFACTOR_LOOP_CAP           - max peer-review feedback/fix cycles before escalation
 *   CI_RETRY_CAP                - max CI fix attempts before escalation (applies to both sequences)
 *   CLARIFICATION_TIMEOUT_HOURS - max wait for clarification response before escalation
 */
 ```
