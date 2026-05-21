/** A live story tracked by the crew. */
export interface StoryRow {
  issueKey: string;
  currentStep: string;
  startedAt: number;
}

/** A single step execution record. */
export interface StepRow {
  issueKey: string;
  step: string;
  sessionId: string | null;
  startedAt: number;
  finishedAt: number | null;
  costUsd: number | null;
  verdict: string | null;
}

/** Outcome recorded when a step completes. */
export interface StepResult {
  costUsd?: number;
  verdict?: string;
}

/**
 * Persistent store for story progression and step execution history.
 *
 * Each crew initialises its own store pointing at a crew-owned DB path.
 * The store also handles webhook deduplication (checkAndRecord) so that
 * story state and idempotency keys share a single database connection
 * and WAL journal — no second SQLite handle needed.
 */
export interface StateStore {
  // Story lifecycle
  upsertStory(issueKey: string, step: string): void;
  getStory(issueKey: string): StoryRow | undefined;
  getStoriesAtStep(step: string): StoryRow[];

  // Step tracking
  startStep(issueKey: string, step: string, sessionId?: string): void;
  finishStep(issueKey: string, step: string, result: StepResult): void;
  getStepHistory(issueKey: string): StepRow[];
  /**
   * Count how many times a given step name appears in the steps table for
   * this story. Useful for enforcing loop caps (e.g. address-feedback runs).
   */
  countStepOccurrences(issueKey: string, step: string): number;
  /** Steps that started a session but never finished — crash candidates. */
  getInterruptedSteps(): StepRow[];

  /**
   * Returns true if (provider, eventId) was seen before; records it if not.
   * Co-located in the same DB so no second connection is needed for webhook
   * deduplication alongside story tracking.
   */
  checkAndRecord(provider: string, eventId: string): boolean;

  ping(): void;
  close(): void;
}
