import type { AgentResult } from '@daddia/crew';
import type { JiraIssue } from '../integrations/jira.js';
import type { PipelineStatus } from '../integrations/gitlab.js';

export interface StoryFixtureEngineerStep {
  success: boolean;
  summary: string;
  artefacts: Record<string, unknown>;
}

export interface StoryFixture {
  issueKey: string;
  jira: {
    issue: JiraIssue;
    parentIssue?: JiraIssue;
  };
  gitlab: {
    pipelineStatus: PipelineStatus;
    mrUrl: string;
  };
  engineer: {
    assess: StoryFixtureEngineerStep;
    implement: StoryFixtureEngineerStep;
  };
}

export type StoryFixtureMode = 'mock' | 'live';

export interface StoryDriverResult {
  success: boolean;
  issueKey: string;
  mode: StoryFixtureMode;
  terminalStep: string;
  implementSessionId?: string;
  jiraTransitions: string[];
  summary: string;
}

export function fixtureEngineerResult(step: StoryFixtureEngineerStep): AgentResult {
  return {
    success: step.success,
    summary: step.summary,
    artefacts: { ...step.artefacts },
    costUsd: 0,
  };
}
