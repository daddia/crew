import { createSqliteStateStore } from '@daddia/crew/state';
import type { StateStore } from '@daddia/crew/state';

export type { StateStore, StoryRow, StepRow, StepResult } from '@daddia/crew/state';

/**
 * Delivery-build step names. Used for local documentation and type narrowing;
 * the shared StateStore interface accepts plain strings so these values are
 * always assignable without a cast.
 */
export type Step =
  | "triage"
  | "context-seed"
  | "assess-clarification"
  | "clarification-pending"
  | "implement"
  | "peer-code-review"
  | "address-feedback"
  | "open-mr"
  | "ci-check"
  | "in-qa"
  | "ready-for-review"
  | "needs-human-review";

/**
 * Crew-specific extension of the shared StateStore.
 * Adds countRefactorIterations as a convenience alias over
 * countStepOccurrences so existing callers don't need updating.
 */
export interface DeliveryStateStore extends StateStore {
  /** @deprecated Use store.countStepOccurrences(issueKey, 'address-feedback') */
  countRefactorIterations(issueKey: string): number;
}

export function createStateStore(dbPath: string): DeliveryStateStore {
  const store = createSqliteStateStore(dbPath);
  return {
    ...store,
    countRefactorIterations(issueKey: string): number {
      return store.countStepOccurrences(issueKey, 'address-feedback');
    },
  };
}
