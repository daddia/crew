import { createRunStreamHub } from '@daddia/crew';
import type { Step } from './state.js';

/** Process-wide hub for operator run-stream subscribers. */
export const runStreamHub = createRunStreamHub();

/** Publish a workflow step transition to operator subscribers. */
export function publishRunStep(issueKey: string, step: Step, sessionId?: string): void {
  runStreamHub.publish({
    type: 'step',
    issueKey,
    step,
    ...(sessionId !== undefined ? { sessionId } : {}),
  });
}
