import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/workflow.js', () => ({
  runQaWorkflow: vi.fn().mockResolvedValue(undefined),
  watchRemediationTimeouts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/observability.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { pollTick } from '../src/poller.js';
import { inFlight } from '../src/in-flight.js';
import { runQaWorkflow } from '../src/workflow.js';
import { log } from '../src/observability.js';
import type { StateStore, Step } from '../src/state.js';
import type { PollerDeps } from '../src/poller.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';

const mockRunQaWorkflow = vi.mocked(runQaWorkflow);
const mockLogWarn = vi.mocked(log.warn);
const mockLogDebug = vi.mocked(log.debug);

function makeMockJira(overrides: Partial<JiraClient> = {}): JiraClient {
  return {
    searchIssues: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
    commentOnIssue: vi.fn().mockResolvedValue(undefined),
    transitionIssue: vi.fn().mockResolvedValue(true),
    getIssue: vi.fn(),
    addLabel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockGitlab(): GitlabClient {
  return {
    getPipelineStatus: vi.fn(),
    getMrSourceBranch: vi.fn(),
    findOpenMrForIssue: vi.fn(),
  };
}

function makePollerDeps(overrides: Partial<PollerDeps> = {}): PollerDeps {
  const { behaviour: behaviourOverrides, ...rest } = overrides;
  const defaultBehaviour: PollerDeps['behaviour'] = {
    pollIntervalMs: 300_000,
    qaDefectLoopCap: 2,
    remediationTimeoutHours: 48,
    externalIntegrationMode: 'mock',
    automatedTestCommand: 'pnpm test',
    qaEngineerMaxTurns: 40,
    qaEngineerCostCapUsd: 4,
  };

  return {
    identity: {
      jira: {
        projectKey: 'CREW',
        assigneeAccountId: 'qa-bot-123',
      },
    },
    jira: makeMockJira(),
    gitlab: makeMockGitlab(),
    qaWorkspaceDir: '/workspace/qa',
    ...rest,
    behaviour: {
      ...defaultBehaviour,
      ...behaviourOverrides,
    },
  };
}

function makeState(
  getStoryImpl?: (
    key: string,
  ) => { issueKey: string; currentStep: Step; startedAt: number } | undefined,
): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn().mockImplementation(getStoryImpl ?? (() => undefined)),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countStepOccurrences: vi.fn().mockReturnValue(0),
    checkAndRecord: vi.fn().mockReturnValue(false),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    ping: vi.fn(),
    close: vi.fn(),
  };
}

function makeStoryRow(issueKey: string, currentStep: Step) {
  return { issueKey, currentStep, startedAt: Date.now() };
}

describe('pollTick', () => {
  beforeEach(() => {
    inFlight.clear();
    mockRunQaWorkflow.mockReset().mockResolvedValue(undefined);
    mockLogWarn.mockReset();
    mockLogDebug.mockReset();
  });

  it('executes a JQL search for In QA tickets assigned to the QA bot', async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);

    await pollTick(deps, makeState());

    expect(deps.jira.searchIssues).toHaveBeenCalledWith(
      'project = "CREW" AND status = "In QA" AND assignee = "qa-bot-123"',
    );
  });

  it('invokes runQaWorkflow for eligible In QA tickets with no in-flight lock', async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: 'CREW-99' }]);

    await pollTick(deps, makeState());

    expect(mockRunQaWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: 'CREW-99' }),
    );
  });

  it('skips tickets that already have a non-terminal state row', async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: 'CREW-99' }]);
    const state = makeState(() => makeStoryRow('CREW-99', 'deploy-qa'));

    await pollTick(deps, state);

    expect(mockRunQaWorkflow).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      'poller.skip-in-progress',
      expect.objectContaining({ issueKey: 'CREW-99' }),
    );
  });

  it('skips tickets that are already in flight', async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: 'CREW-99' }]);
    inFlight.add('CREW-99');

    await pollTick(deps, makeState());

    expect(mockRunQaWorkflow).not.toHaveBeenCalled();
  });

  it('logs a warn and skips search when projectKey is not set', async () => {
    const deps = makePollerDeps({
      identity: { jira: { projectKey: '', assigneeAccountId: 'qa-bot-123' } },
    });
    await pollTick(deps, makeState());
    expect(deps.jira.searchIssues).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      'poller.misconfigured',
      expect.objectContaining({ missing: ['identity.jira.projectKey'] }),
    );
  });
});
