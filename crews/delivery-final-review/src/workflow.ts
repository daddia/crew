import type { StateStore } from './state.js';
import { log } from './observability.js';

export interface WorkflowContext {
  issueKey: string;
  state: StateStore;
}

/**
 * Run the delivery-review sequence for one story.
 *
 * Authoritative contract: docs/design/crew-flows/delivery-review.md
 * Implementation spec: docs/work/06-delivery-review/design.md
 *
 * TODO: implement — scaffold only; full implementation is CREW-06-03+.
 */
export async function runReview(ctx: WorkflowContext): Promise<void> {
  const { issueKey } = ctx;
  log.info('workflow.review.start', { issueKey });
  throw new Error('delivery-review: not yet implemented');
}
