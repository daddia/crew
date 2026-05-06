import type { StateStore } from "./state.js";
import { log } from "./observability.js";

export interface WorkflowContext {
  issueKey: string;
  state: StateStore;
}

/**
 * Run the delivery review sequence for one story.
 *
 * Trigger:
 *   `ready-for-review` event from delivery-build crew
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
 * Operational notes:
 *   - PM review is serial and blocking; merge cannot occur without explicit PM sign-off
 *   - Four-eyes merge policy not enforced at this crew boundary (tech-lead reviews AND merges);
 *     promote to separate approver/merger roles if policy requires separation of duties
 *   - PM_REVIEW_TIMEOUT_HOURS should reflect team SLA for stakeholder availability
 *
 * TODO: implement — this crew is scaffolded; full implementation follows delivery-build proof.
 */
export async function runReview(ctx: WorkflowContext): Promise<void> {
  const { issueKey } = ctx;
  log.info("workflow.review.start", { issueKey });
  throw new Error("delivery-review: not yet implemented");
}
