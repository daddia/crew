import { createSqliteStateStore } from '@daddia/crew/state';
import type {
  StateStore as BaseStateStore,
  StepResult,
  StepRow as BaseStepRow,
  StoryRow as BaseStoryRow,
} from '@daddia/crew/state';

export type Step =
  | 'triage'
  | 'context-seed'
  | 'assess-clarification'
  | 'clarification-pending'
  | 'implement'
  | 'peer-code-review'
  | 'address-feedback'
  | 'open-mr'
  | 'ci-check'
  | 'in-qa'
  | 'qa-remediation'
  | 'fix-qa-defects'
  | 'ready-for-review'
  | 'needs-human-review';

export type StoryRow = Omit<BaseStoryRow, 'currentStep'> & { currentStep: Step };
export type StepRow = Omit<BaseStepRow, 'step'> & { step: Step };

export interface StateStore
  extends Omit<
    BaseStateStore,
    | 'upsertStory'
    | 'getStory'
    | 'getStoriesAtStep'
    | 'startStep'
    | 'finishStep'
    | 'getStepHistory'
    | 'getInterruptedSteps'
  > {
  upsertStory(issueKey: string, step: Step): void;
  getStory(issueKey: string): StoryRow | undefined;
  getStoriesAtStep(step: Step): StoryRow[];
  startStep(issueKey: string, step: Step, sessionId?: string): void;
  finishStep(issueKey: string, step: Step, result: StepResult): void;
  getStepHistory(issueKey: string): StepRow[];
  getInterruptedSteps(): StepRow[];
}

export function createStateStore(dbPath: string): StateStore {
  return createSqliteStateStore(dbPath) as StateStore;
}
