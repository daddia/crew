import { createSqliteStateStore } from '@daddia/crew/state';
import type {
  StateStore as BaseStateStore,
  StepResult,
  StepRow as BaseStepRow,
  StoryRow as BaseStoryRow,
} from '@daddia/crew/state';

export const STEPS = [
  'context-seed',
  'final-code-review',
  'stakeholder-review-pending',
  'merge-and-close',
  'done',
  'needs-human-review',
] as const;

export type Step = (typeof STEPS)[number];

export type StoryRow = Omit<BaseStoryRow, 'currentStep'> & { currentStep: Step };
export type StepRow = Omit<BaseStepRow, 'step'> & { step: Step };

export interface StateStore extends Omit<
  BaseStateStore,
  'upsertStory' | 'getStory' | 'getStoriesAtStep' | 'startStep' | 'finishStep' | 'getStepHistory'
> {
  upsertStory(issueKey: string, step: Step): void;
  getStory(issueKey: string): StoryRow | undefined;
  getStoriesAtStep(step: Step): StoryRow[];
  startStep(issueKey: string, step: Step, sessionId?: string): void;
  finishStep(issueKey: string, step: Step, result: StepResult): void;
  getStepHistory(issueKey: string): StepRow[];
}

export function createStateStore(dbPath: string): StateStore {
  return createSqliteStateStore(dbPath) as StateStore;
}
