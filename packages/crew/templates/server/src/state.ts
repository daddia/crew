import { createSqliteStateStore } from '@daddia/crew/state';
import type {
  StateStore as BaseStateStore,
  StepResult,
  StepRow as BaseStepRow,
  StoryRow as BaseStoryRow,
} from '@daddia/crew/state';

export type Step = 'run-task' | 'done' | 'needs-human-review';

export type StoryRow = Omit<BaseStoryRow, 'currentStep'> & { currentStep: Step };
export type StepRow = Omit<BaseStepRow, 'step'> & { step: Step };

export interface StateStore extends Omit<
  BaseStateStore,
  'upsertStory' | 'getStory' | 'startStep' | 'finishStep' | 'getStepHistory'
> {
  upsertStory(issueKey: string, step: Step): void;
  getStory(issueKey: string): StoryRow | undefined;
  startStep(issueKey: string, step: Step, sessionId?: string): void;
  finishStep(issueKey: string, step: Step, result: StepResult): void;
  getStepHistory(issueKey: string): StepRow[];
}

export function createStateStore(dbPath: string): StateStore {
  return createSqliteStateStore(dbPath) as StateStore;
}
