import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/workflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workflow.js')>();
  return {
    ...actual,
    runReviewWorkflow: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../src/observability.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { pollTick, startPoller } from '../src/poller.js';
import { inFlight } from '../src/in-flight.js';
import { runReviewWorkflow } from '../src/workflow.js';
import { log } from '../src/observability.js';
import type { StateStore, Step, StepRow } from '../src/state.js';
import type { PollerDeps } from '../src/poller.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';

const mockRunReviewWorkflow = vi.mocked(runReviewWorkflow);
const mockLogInfo = vi.mocked(log.info);
const mockLogWarn = vi.mocked(log.warn);
const mockLogDebug = vi.mocked(log.debug);

const PM_APPROVER_ID = 'pm-account-123';
const MR_URL = 'https://gitlab.example.com/group/project/-/merge_requests/42';

function makeMockJira(overrides: Partial<JiraClient> = {}): JiraClient {
  return {
    searchIssues: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
    commentOnIssue: vi.fn().mockResolvedValue(undefined),
    transitionIssue: vi.fn().mockResolvedValue(true),
    getIssue: vi.fn().mockResolvedValue({
      summary: 'Review Story',
      description: null,
      acceptanceCriteria: null,
    }),
    getIssueStatus: vi.fn().mockResolvedValue('In Review'),
    ...overrides,
  };
}

function makeMockGitlab(overrides: Partial<GitlabClient> = {}): GitlabClient {
  return {
    findOpenMrForIssue: vi.fn().mockResolvedValue(MR_URL),
    findMrForIssue: vi.fn().mockResolvedValue({ mrUrl: MR_URL, state: 'opened' }),
    getPipelineStatus: vi.fn().mockResolvedValue('success'),
    getMrSourceBranch: vi.fn().mockResolvedValue('feature/CREW-1'),
    getMrDiff: vi.fn().mockResolvedValue(''),
    approveMergeRequest: vi.fn().mockResolvedValue(undefined),
    mergeMergeRequest: vi.fn().mockResolvedValue('abc123merge'),
    ...overrides,
  };
}

function makePollerDeps(overrides: Partial<PollerDeps> = {}): PollerDeps {
  const { behaviour: behaviourOverrides, identity: identityOverrides, ...rest } = overrides;
  const defaultBehaviour: PollerDeps['behaviour'] = {
    pollIntervalMs: 300_000,
    pmReviewTimeoutHours: 48,
    pmApprovalCommentPattern: '/pm-approve',
    techLeadMaxTurns: 30,
    techLeadCostCapUsd: 5,
    diffFileCap: 50,
    diffSizeCapBytes: 500_000,
  };

  return {
    dbPath: '/tmp/delivery-review-poller-test.db',
    identity: {
      jira: {
        projectKey: 'CREW',
        assigneeAccountId: 'review-bot-123',
        pmApproverAccountIds: [PM_APPROVER_ID],
        ...identityOverrides?.jira,
      },
    },
    jira: makeMockJira(),
    gitlab: makeMockGitlab(),
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
): StateStore & {
  stories: Map<string, { currentStep: Step; startedAt: number }>;
} {
  const stories = new Map<string, { currentStep: Step; startedAt: number }>();

  return {
    stories,
    upsertStory: vi.fn((issueKey: string, step: Step) => {
      const existing = stories.get(issueKey);
      if (!existing) {
        stories.set(issueKey, { currentStep: step, startedAt: Date.now() });
      } else {
        existing.currentStep = step;
      }
    }),
    getStory: vi.fn().mockImplementation((issueKey: string) => {
      const story = stories.get(issueKey) ?? getStoryImpl?.(issueKey);
      return story ? { issueKey, ...story } : undefined;
    }),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countStepOccurrences: vi.fn().mockReturnValue(0),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    ping: vi.fn(),
    close: vi.fn(),
  };
}

function makeStoryRow(issueKey: string, currentStep: Step, startedAt = Date.now()) {
  return { issueKey, currentStep, startedAt };
}

function makePendingStep(issueKey: string, startedAt: number): StepRow {
  return {
    issueKey,
    step: 'stakeholder-review-pending',
    sessionId: null,
    startedAt,
    finishedAt: startedAt + 100,
    costUsd: null,
    verdict: 'pending',
  };
}

describe('pollTick stakeholder HITL (CREW-06-04)', () => {
  beforeEach(() => {
    inFlight.clear();
    mockRunReviewWorkflow.mockReset().mockResolvedValue(undefined);
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogDebug.mockReset();
  });

  it('PM comment approval resumes workflow and logs poller.stakeholder-resolved', async () => {
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      makeStoryRow('CREW-PM1', 'stakeholder-review-pending', pendingStartedAt),
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([
      makePendingStep('CREW-PM1', pendingStartedAt),
    ]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([
      {
        accountId: PM_APPROVER_ID,
        author: 'pm@example.com',
        body: 'Looks good /pm-approve',
        created: new Date(pendingStartedAt + 500).toISOString(),
      },
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunReviewWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: 'CREW-PM1', state }),
      { resumeFromMerge: true },
    );
    expect(mockLogInfo).toHaveBeenCalledWith('poller.stakeholder-resolved', {
      issueKey: 'CREW-PM1',
    });
  });

  it('ignores non-approver comment matching /pm-approve', async () => {
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      makeStoryRow('CREW-PM2', 'stakeholder-review-pending', pendingStartedAt),
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([
      makePendingStep('CREW-PM2', pendingStartedAt),
    ]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([
      {
        accountId: 'human-not-pm',
        author: 'human@example.com',
        body: '/pm-approve',
        created: new Date(pendingStartedAt + 500).toISOString(),
      },
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunReviewWorkflow).not.toHaveBeenCalled();
  });

  it('PM approval timeout escalates and logs poller.stakeholder-timeout', async () => {
    const pendingStartedAt = Date.now() - 49 * 60 * 60 * 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      makeStoryRow('CREW-PM3', 'stakeholder-review-pending', pendingStartedAt),
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([
      makePendingStep('CREW-PM3', pendingStartedAt),
    ]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.jira.transitionIssue).toHaveBeenCalledWith('CREW-PM3', 'Needs human review');
    expect(state.getStory('CREW-PM3')?.currentStep).toBe('needs-human-review');
    expect(deps.jira.commentOnIssue).toHaveBeenCalledWith(
      'CREW-PM3',
      expect.stringContaining('PM approval timeout'),
    );
    expect(mockLogWarn).toHaveBeenCalledWith(
      'poller.stakeholder-timeout',
      expect.objectContaining({ issueKey: 'CREW-PM3' }),
    );
    expect(mockRunReviewWorkflow).not.toHaveBeenCalled();
  });

  it('does not count pre-pending /pm-approve comments as approval', async () => {
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      makeStoryRow('CREW-PM4', 'stakeholder-review-pending', pendingStartedAt),
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([
      makePendingStep('CREW-PM4', pendingStartedAt),
    ]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([
      {
        accountId: PM_APPROVER_ID,
        author: 'pm@example.com',
        body: '/pm-approve',
        created: new Date(pendingStartedAt - 500).toISOString(),
      },
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunReviewWorkflow).not.toHaveBeenCalled();
  });

  it('external merge with Jira still In Review escalates without dispatching workflow', async () => {
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps({
      gitlab: makeMockGitlab({
        findMrForIssue: vi.fn().mockResolvedValue({ mrUrl: MR_URL, state: 'merged' }),
      }),
    });
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    vi.mocked(deps.jira.getIssueStatus).mockResolvedValue('In Review');
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      makeStoryRow('CREW-PM5', 'stakeholder-review-pending', pendingStartedAt),
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([
      makePendingStep('CREW-PM5', pendingStartedAt),
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.jira.transitionIssue).toHaveBeenCalledWith('CREW-PM5', 'Needs human review');
    expect(state.getStory('CREW-PM5')?.currentStep).toBe('needs-human-review');
    expect(deps.jira.commentOnIssue).toHaveBeenCalledWith(
      'CREW-PM5',
      expect.stringContaining('MR merged externally'),
    );
    expect(mockRunReviewWorkflow).not.toHaveBeenCalled();
  });

  it('external merge with Jira Done reconciles local state to done', async () => {
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps({
      gitlab: makeMockGitlab({
        findMrForIssue: vi.fn().mockResolvedValue({ mrUrl: MR_URL, state: 'merged' }),
      }),
    });
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    vi.mocked(deps.jira.getIssueStatus).mockResolvedValue('Done');
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      makeStoryRow('CREW-PM6', 'stakeholder-review-pending', pendingStartedAt),
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([
      makePendingStep('CREW-PM6', pendingStartedAt),
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(state.upsertStory)).toHaveBeenCalledWith('CREW-PM6', 'done');
    expect(mockRunReviewWorkflow).not.toHaveBeenCalled();
    expect(deps.jira.transitionIssue).not.toHaveBeenCalledWith('CREW-PM6', 'Needs human review');
  });
});

describe('pollTick new work', () => {
  beforeEach(() => {
    inFlight.clear();
    mockRunReviewWorkflow.mockReset().mockResolvedValue(undefined);
  });

  it('searches In Review tickets assigned to the review bot', async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);

    await pollTick(deps, makeState());

    expect(deps.jira.searchIssues).toHaveBeenCalledWith(
      'project = "CREW" AND status = "In Review" AND assignee = "review-bot-123"',
    );
  });

  it('dispatches runReviewWorkflow for new In Review stories', async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: 'CREW-NEW' }]);
    const state = makeState();

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunReviewWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: 'CREW-NEW', state }),
    );
  });

  it('skips in-progress non-terminal stories', async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: 'CREW-IP' }]);
    const state = makeState(() => makeStoryRow('CREW-IP', 'final-code-review'));

    await pollTick(deps, state);

    expect(mockRunReviewWorkflow).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      'poller.skip-in-progress',
      expect.objectContaining({ issueKey: 'CREW-IP' }),
    );
  });
});

describe('startPoller', () => {
  beforeEach(() => {
    inFlight.clear();
    vi.useFakeTimers();
    mockRunReviewWorkflow.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires at the configured pollIntervalMs', async () => {
    const deps = makePollerDeps({ behaviour: { pollIntervalMs: 300_000 } });
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const interval = startPoller(deps, makeState());

    await vi.advanceTimersByTimeAsync(300_000);
    expect(deps.jira.searchIssues).toHaveBeenCalledTimes(1);

    clearInterval(interval);
  });
});
