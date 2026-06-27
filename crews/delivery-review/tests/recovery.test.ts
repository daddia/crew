import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/observability.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  tracer: {
    startActiveSpan: vi.fn(
      (_name: string, fn: (span: { setAttribute: () => void; end: () => void }) => unknown) =>
        fn({ setAttribute: vi.fn(), end: vi.fn() }),
    ),
  },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  getSessionInfo: vi.fn(),
}));

vi.mock('../src/agents/tech-lead/agent.js', () => ({
  techLead: { name: 'tech-lead', run: vi.fn() },
}));

import { recoverInterruptedSteps } from '../src/workflow.js';
import type { WorkflowCtxBase } from '../src/workflow.js';
import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../src/observability.js';
import { techLead } from '../src/agents/tech-lead/agent.js';
import type { StateStore, StepRow } from '../src/state.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';

const mockGetSessionInfo = vi.mocked(getSessionInfo);
const mockLogInfo = vi.mocked(log.info);
const mockLogWarn = vi.mocked(log.warn);
const mockLogError = vi.mocked(log.error);
const mockTechLead = vi.mocked(techLead.run);

const MR_URL = 'https://gitlab.example.com/group/project/-/merge_requests/42';

function makeMockJira() {
  return {
    transitionIssue: vi.fn().mockResolvedValue(true),
    commentOnIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn().mockResolvedValue({
      summary: 'Test',
      description: 'desc',
      acceptanceCriteria: 'Given When Then',
    }),
    getIssueStatus: vi.fn().mockResolvedValue('In Review'),
    getComments: vi.fn().mockResolvedValue([]),
    searchIssues: vi.fn().mockResolvedValue([]),
  } satisfies JiraClient;
}

function makeMockGitlab() {
  return {
    findOpenMrForIssue: vi.fn().mockResolvedValue(MR_URL),
    findMrForIssue: vi.fn().mockResolvedValue({ mrUrl: MR_URL, state: 'opened' }),
    getPipelineStatus: vi.fn().mockResolvedValue('success'),
    getMrSourceBranch: vi.fn().mockResolvedValue('feature/CREW-1-test'),
    getMrDiff: vi.fn().mockResolvedValue(''),
    approveMergeRequest: vi.fn().mockResolvedValue(undefined),
    mergeMergeRequest: vi.fn().mockResolvedValue('abc123'),
  } satisfies GitlabClient;
}

function makeCtxBase(): WorkflowCtxBase & {
  jira: ReturnType<typeof makeMockJira>;
  gitlab: ReturnType<typeof makeMockGitlab>;
} {
  return {
    behaviour: {
      pmReviewTimeoutHours: 48,
      pmApprovalCommentPattern: '/pm-approve',
      techLeadMaxTurns: 30,
      techLeadCostCapUsd: 5,
      diffFileCap: 50,
      diffSizeCapBytes: 500_000,
    },
    jira: makeMockJira(),
    gitlab: makeMockGitlab(),
  };
}

function makeInterruptedRow(overrides: Partial<StepRow> = {}): StepRow {
  return {
    issueKey: 'CREW-63-001',
    step: 'final-code-review',
    sessionId: 'sess_abc',
    startedAt: Date.now() - 5000,
    finishedAt: null,
    costUsd: null,
    verdict: null,
    ...overrides,
  };
}

function makeSuccessResult() {
  return {
    success: true,
    summary: 'approved',
    artefacts: { verdict: 'approve', sessionId: 'sess_new' },
    costUsd: 0.01,
  };
}

function makeState(interrupted: StepRow[] = []): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi
      .fn()
      .mockReturnValue({ issueKey: 'CREW-63-001', currentStep: 'final-code-review' }),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countStepOccurrences: vi.fn().mockReturnValue(0),
    checkAndRecord: vi.fn().mockReturnValue(false),
    getInterruptedSteps: vi.fn().mockReturnValue(interrupted),
    ping: vi.fn(),
    close: vi.fn(),
  };
}

describe('recoverInterruptedSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionInfo.mockResolvedValue({
      sessionId: 'sess_default',
      summary: 'test',
      lastModified: 0,
    });
    mockTechLead.mockResolvedValue(makeSuccessResult());
  });

  it('completes silently when there are no interrupted steps', async () => {
    const ctxBase = makeCtxBase();
    const state = makeState([]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockGetSessionInfo).not.toHaveBeenCalled();
    expect(mockLogWarn).not.toHaveBeenCalled();
    expect(mockLogInfo).not.toHaveBeenCalledWith('recovery.session-resumed', expect.anything());
  });

  it('calls getSessionInfo with the stored sessionId', async () => {
    const ctxBase = makeCtxBase();
    const state = makeState([makeInterruptedRow({ sessionId: 'sess_abc' })]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockGetSessionInfo).toHaveBeenCalledWith('sess_abc', {
      dir: expect.stringContaining('tech-lead'),
    });
  });

  it('emits an info log with issueKey, step, and sessionId on successful resume', async () => {
    const ctxBase = makeCtxBase();
    const state = makeState([
      makeInterruptedRow({
        issueKey: 'CREW-63-001',
        step: 'final-code-review',
        sessionId: 'sess_abc',
      }),
    ]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockLogInfo).toHaveBeenCalledWith(
      'recovery.session-resumed',
      expect.objectContaining({
        issueKey: 'CREW-63-001',
        step: 'final-code-review',
        sessionId: 'sess_abc',
      }),
    );
  });

  it('restarts the review workflow after a successful session resume', async () => {
    const ctxBase = makeCtxBase();
    const state = makeState([makeInterruptedRow({ issueKey: 'CREW-63-001' })]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockTechLead).toHaveBeenCalled();
    expect(ctxBase.jira.commentOnIssue).toHaveBeenCalledWith(
      'CREW-63-001',
      expect.stringContaining('Stakeholder review required'),
    );
  });

  it('emits a warn log and escalates when getSessionInfo throws', async () => {
    const ctxBase = makeCtxBase();
    mockGetSessionInfo.mockRejectedValue(new Error('session not found'));
    const state = makeState([
      makeInterruptedRow({ issueKey: 'CREW-63-001', sessionId: 'sess_gone' }),
    ]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockLogWarn).toHaveBeenCalledWith(
      'recovery.session-failed',
      expect.objectContaining({ issueKey: 'CREW-63-001', sessionId: 'sess_gone' }),
    );
    expect(ctxBase.jira.commentOnIssue).toHaveBeenCalledWith(
      'CREW-63-001',
      expect.stringContaining('Escalated'),
    );
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith('CREW-63-001', 'Needs human review');
  });

  it('processes all interrupted rows', async () => {
    const ctxBase = makeCtxBase();
    const state = makeState([
      makeInterruptedRow({ issueKey: 'CREW-63-001', sessionId: 'sess_1' }),
      makeInterruptedRow({ issueKey: 'CREW-63-002', sessionId: 'sess_2' }),
    ]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockGetSessionInfo).toHaveBeenCalledTimes(2);
    expect(mockGetSessionInfo).toHaveBeenCalledWith('sess_1', expect.any(Object));
    expect(mockGetSessionInfo).toHaveBeenCalledWith('sess_2', expect.any(Object));
  });

  it('continues to the next row after one row fails', async () => {
    const ctxBase = makeCtxBase();
    mockGetSessionInfo
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValueOnce({ sessionId: 'sess_ok', summary: 'ok', lastModified: 0 });
    const state = makeState([
      makeInterruptedRow({ issueKey: 'CREW-63-001', sessionId: 'sess_gone' }),
      makeInterruptedRow({ issueKey: 'CREW-63-002', sessionId: 'sess_ok' }),
    ]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockLogWarn).toHaveBeenCalledWith(
      'recovery.session-failed',
      expect.objectContaining({ issueKey: 'CREW-63-001' }),
    );
    expect(mockLogInfo).toHaveBeenCalledWith(
      'recovery.session-resumed',
      expect.objectContaining({ issueKey: 'CREW-63-002' }),
    );
  });

  it('continues to the next row when escalation itself throws', async () => {
    const ctxBase = makeCtxBase();
    mockGetSessionInfo
      .mockRejectedValueOnce(new Error('session gone'))
      .mockResolvedValueOnce({ sessionId: 'sess_ok', summary: 'ok', lastModified: 0 });
    ctxBase.jira.commentOnIssue.mockRejectedValueOnce(new Error('Jira unreachable'));
    const state = makeState([
      makeInterruptedRow({ issueKey: 'CREW-63-001', sessionId: 'sess_gone' }),
      makeInterruptedRow({ issueKey: 'CREW-63-002', sessionId: 'sess_ok' }),
    ]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockLogError).toHaveBeenCalledWith(
      'recovery.escalation-failed',
      expect.objectContaining({ issueKey: 'CREW-63-001' }),
    );
    expect(mockLogInfo).toHaveBeenCalledWith(
      'recovery.session-resumed',
      expect.objectContaining({ issueKey: 'CREW-63-002' }),
    );
  });
});
