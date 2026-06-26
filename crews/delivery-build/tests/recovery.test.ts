import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/observability.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  tracer: {
    startActiveSpan: vi.fn((_name: string, fn: (span: { setAttribute: () => void; end: () => void }) => unknown) =>
      fn({ setAttribute: vi.fn(), end: vi.fn() }),
    ),
  },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  getSessionInfo: vi.fn(),
}));

vi.mock('../src/agents/engineer/agent.js', () => ({
  engineer: { name: 'engineer', run: vi.fn() },
}));
vi.mock('../src/agents/senior-engineer/agent.js', () => ({
  seniorEngineer: { name: 'senior-engineer', run: vi.fn() },
}));
vi.mock('../src/memory.js', () => ({
  seedEngineerMemory: vi.fn().mockResolvedValue(undefined),
}));

import { recoverInterruptedSteps } from '../src/workflow.js';
import type { WorkflowCtxBase } from '../src/workflow.js';
import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../src/observability.js';
import { engineer } from '../src/agents/engineer/agent.js';
import { seniorEngineer } from '../src/agents/senior-engineer/agent.js';
import type { StateStore, StepRow } from '../src/state.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';

const mockGetSessionInfo = vi.mocked(getSessionInfo);
const mockLogInfo = vi.mocked(log.info);
const mockLogWarn = vi.mocked(log.warn);
const mockLogError = vi.mocked(log.error);
const mockEngineer = vi.mocked(engineer.run);
const mockSeniorEngineer = vi.mocked(seniorEngineer.run);

function makeMockJira() {
  return {
    transitionIssue: vi.fn().mockResolvedValue(undefined),
    commentOnIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi
      .fn()
      .mockResolvedValue({ summary: 'Test', description: 'desc', acceptanceCriteria: null }),
    searchIssues: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
  } satisfies JiraClient;
}

function makeMockGitlab() {
  return {
    createMr: vi.fn().mockResolvedValue('https://gitlab.example.com/mr/1'),
    getMrDiff: vi.fn().mockResolvedValue(''),
    postReviewComment: vi.fn().mockResolvedValue(undefined),
    getPipelineStatus: vi.fn().mockResolvedValue('success'),
  } satisfies GitlabClient;
}

function makeCtxBase(): WorkflowCtxBase & {
  jira: ReturnType<typeof makeMockJira>;
  gitlab: ReturnType<typeof makeMockGitlab>;
} {
  return {
    behaviour: { refactorLoopCap: 2, ciRetryCap: 3, ciPollIntervalMs: 0, ciWaitTimeoutMs: 1_800_000, engineerMaxTurns: 50, engineerCostCapUsd: 5, modelRouting: { lowCost: 'claude-sonnet-test', implementation: 'claude-opus-test' } },
    jira: makeMockJira(),
    gitlab: makeMockGitlab(),
    projectDir: '/project',
  };
}

function makeInterruptedRow(overrides: Partial<StepRow> = {}): StepRow {
  return {
    issueKey: 'CREW-63-001',
    step: 'implement',
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
    summary: 'ok',
    artefacts: { branchName: 'feature/CREW-63-001-test', title: 'Test' },
    costUsd: 0.01,
  };
}

function makeState(interrupted: StepRow[] = []): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn(),
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
    mockGetSessionInfo.mockResolvedValue({
      sessionId: 'sess_abc',
      summary: 'test',
      lastModified: 0,
    });
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
    const state = makeState([makeInterruptedRow({ sessionId: 'sess_abc' })]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockGetSessionInfo).toHaveBeenCalledWith('sess_abc', { dir: '/project' });
  });

  it('emits an info log with issueKey, step, and sessionId on successful resume', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
    const state = makeState([
      makeInterruptedRow({ issueKey: 'CREW-63-001', step: 'implement', sessionId: 'sess_abc' }),
    ]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockLogInfo).toHaveBeenCalledWith(
      'recovery.session-resumed',
      expect.objectContaining({
        issueKey: 'CREW-63-001',
        step: 'implement',
        sessionId: 'sess_abc',
      }),
    );
  });

  it('calls runStory after a successful session resume', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
    const state = makeState([makeInterruptedRow({ issueKey: 'CREW-63-001' })]);

    await recoverInterruptedSteps(state, ctxBase);

    // runStory drives the workflow; verifying the Jira transition confirms it ran
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith('CREW-63-001', 'In QA');
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

  it('processes all interrupted rows — second row is also attempted after first succeeds', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
    const state = makeState([
      makeInterruptedRow({ issueKey: 'CREW-63-001', sessionId: 'sess_1' }),
      makeInterruptedRow({ issueKey: 'CREW-63-002', sessionId: 'sess_2' }),
    ]);

    await recoverInterruptedSteps(state, ctxBase);

    expect(mockGetSessionInfo).toHaveBeenCalledTimes(2);
    expect(mockGetSessionInfo).toHaveBeenCalledWith('sess_1', { dir: '/project' });
    expect(mockGetSessionInfo).toHaveBeenCalledWith('sess_2', { dir: '/project' });
  });

  it('continues to the next row after one row fails', async () => {
    const ctxBase = makeCtxBase();
    mockGetSessionInfo
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValueOnce({ sessionId: 'sess_ok', summary: 'ok', lastModified: 0 });
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
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

  it('emits workflow.complete with success: false when crash recovery escalates', async () => {
    const ctxBase = makeCtxBase();
    mockGetSessionInfo.mockResolvedValue(undefined);
    const state = makeState([
      makeInterruptedRow({ issueKey: 'CREW-63-001', sessionId: 'sess_gone' }),
    ]);

    await recoverInterruptedSteps(state, ctxBase);

    const completeCall = mockLogInfo.mock.calls.find((c) => c[0] === 'workflow.complete');
    expect(completeCall).toBeDefined();
    const payload = completeCall![1] as Record<string, unknown>;
    expect(payload['success']).toBe(false);
    expect(payload['terminalStep']).toBe('needs-human-review');
    expect(payload['issueKey']).toBe('CREW-63-001');
  });

  it('continues to the next row when escalation itself throws', async () => {
    const ctxBase = makeCtxBase();
    mockGetSessionInfo
      .mockRejectedValueOnce(new Error('session gone'))
      .mockResolvedValueOnce({ sessionId: 'sess_ok', summary: 'ok', lastModified: 0 });
    // First row's escalation fails (e.g. Jira unreachable)
    ctxBase.jira.commentOnIssue.mockRejectedValueOnce(new Error('Jira unreachable'));
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
    const state = makeState([
      makeInterruptedRow({ issueKey: 'CREW-63-001', sessionId: 'sess_gone' }),
      makeInterruptedRow({ issueKey: 'CREW-63-002', sessionId: 'sess_ok' }),
    ]);

    await recoverInterruptedSteps(state, ctxBase);

    // Escalation failure is logged at error level, not warn
    expect(mockLogError).toHaveBeenCalledWith(
      'recovery.escalation-failed',
      expect.objectContaining({ issueKey: 'CREW-63-001' }),
    );
    // Second row is still attempted despite the first row's escalation failure
    expect(mockLogInfo).toHaveBeenCalledWith(
      'recovery.session-resumed',
      expect.objectContaining({ issueKey: 'CREW-63-002' }),
    );
  });
});
