/**
 * CREW-67-002 — Per-story cost summary log on workflow completion.
 *
 * Verifies that `workflow.complete` is emitted at every terminal exit point
 * with the correct payload shape, including aggregated cost fields.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentResult } from '@daddia/crew';

vi.mock('../src/memory.js', () => ({
  seedEngineerMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/observability.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/agents/engineer/agent.js', () => ({
  engineer: { name: 'engineer', run: vi.fn() },
}));
vi.mock('../src/agents/senior-engineer/agent.js', () => ({
  seniorEngineer: { name: 'senior-engineer', run: vi.fn() },
}));

import { runStory, addressFeedback } from '../src/workflow.js';
import type { WorkflowCtxBase } from '../src/workflow.js';
import { log } from '../src/observability.js';
import { engineer } from '../src/agents/engineer/agent.js';
import { seniorEngineer } from '../src/agents/senior-engineer/agent.js';
import type { StateStore, StepRow } from '../src/state.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';

const mockEngineer = vi.mocked(engineer.run);
const mockSeniorEngineer = vi.mocked(seniorEngineer.run);
const mockLogInfo = vi.mocked(log.info);

// ── Fixture factories ──────────────────────────────────────────────────────

function makeJira(): JiraClient {
  return {
    transitionIssue: vi.fn().mockResolvedValue(undefined),
    commentOnIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi
      .fn()
      .mockResolvedValue({ summary: 'Test', description: 'desc', acceptanceCriteria: null }),
    searchIssues: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
  };
}

function makeGitlab(): GitlabClient {
  return {
    createMr: vi.fn().mockResolvedValue('https://gitlab.example.com/mr/1'),
    getMrDiff: vi.fn().mockResolvedValue(''),
    postReviewComment: vi.fn().mockResolvedValue(undefined),
    getPipelineStatus: vi.fn().mockResolvedValue('success'),
  };
}

function makeCtxBase(
  behaviourOverrides: Partial<WorkflowCtxBase['behaviour']> = {},
): WorkflowCtxBase & {
  jira: ReturnType<typeof makeJira>;
  gitlab: ReturnType<typeof makeGitlab>;
} {
  return {
    behaviour: { refactorLoopCap: 2, ciRetryCap: 3, ciPollIntervalMs: 0, ...behaviourOverrides },
    jira: makeJira(),
    gitlab: makeGitlab(),
    projectDir: '/project',
  };
}

function makeStepRow(overrides: Partial<StepRow> = {}): StepRow {
  return {
    issueKey: 'ENG-1',
    step: 'implement',
    sessionId: null,
    startedAt: Date.now() - 5000,
    finishedAt: Date.now(),
    costUsd: 0,
    verdict: 'ok',
    ...overrides,
  };
}

function makeState(history: StepRow[] = []): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue(history),
    countRefactorIterations: vi.fn().mockReturnValue(0),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    ping: vi.fn(),
    close: vi.fn(),
  };
}

function successResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    summary: 'ok',
    artefacts: { branchName: 'feature/ENG-1-test', title: 'Test' },
    costUsd: 0.01,
    ...overrides,
  };
}

// Helper that finds the workflow.complete call in log.info mock calls
function findCompleteCall(): [string, Record<string, unknown>] | undefined {
  const call = mockLogInfo.mock.calls.find((c) => c[0] === 'workflow.complete');
  return call as [string, Record<string, unknown>] | undefined;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('workflow.complete — happy path (In QA)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits workflow.complete with success: true on In QA handoff', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    const call = findCompleteCall();
    expect(call).toBeDefined();
    const [, payload] = call!;
    expect(payload['success']).toBe(true);
    expect(payload['terminalStep']).toBe('in-qa');
  });

  it('includes mrUrl in the payload on In QA handoff', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['mrUrl']).toBe('https://gitlab.example.com/mr/1');
  });

  it('sums totalCostUsd across all step rows (including non-agent steps)', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const history = [
      makeStepRow({ step: 'implement', sessionId: 'sess_1', costUsd: 0.5 }),
      makeStepRow({ step: 'peer-code-review', sessionId: null, costUsd: 0.1 }),
      makeStepRow({ step: 'address-feedback', sessionId: 'sess_2', costUsd: 0.2 }),
    ];
    const state = makeState(history);

    await runStory({ issueKey: 'ENG-1', state, ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['totalCostUsd']).toBeCloseTo(0.8);
  });

  it('agentSteps contains only rows with a non-null sessionId', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const history = [
      makeStepRow({ step: 'implement', sessionId: 'sess_1', costUsd: 0.5 }),
      makeStepRow({ step: 'peer-code-review', sessionId: null, costUsd: 0.1 }),
    ];
    const state = makeState(history);

    await runStory({ issueKey: 'ENG-1', state, ...ctxBase });

    const [, payload] = findCompleteCall()!;
    const agentSteps = payload['agentSteps'] as unknown[];
    expect(agentSteps).toHaveLength(1);
    expect(agentSteps[0]).toMatchObject({ step: 'implement', sessionId: 'sess_1', costUsd: 0.5 });
  });

  it('emits totalCostUsd: 0 and agentSteps: [] when history is empty', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    await runStory({ issueKey: 'ENG-1', state: makeState([]), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['totalCostUsd']).toBe(0);
    expect(payload['agentSteps']).toEqual([]);
  });

  it('includes stepCount equal to the number of history rows', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const history = [
      makeStepRow({ step: 'implement', sessionId: 'sess_1', costUsd: 0.3 }),
      makeStepRow({ step: 'peer-code-review', sessionId: null, costUsd: 0.1 }),
    ];

    await runStory({ issueKey: 'ENG-1', state: makeState(history), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['stepCount']).toBe(2);
  });

  it('includes a numeric durationMs in the payload', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(typeof payload['durationMs']).toBe('number');
    expect(payload['durationMs']).toBeGreaterThanOrEqual(0);
  });

  it('emits exactly one workflow.complete per runStory call', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    const completeCalls = mockLogInfo.mock.calls.filter((c) => c[0] === 'workflow.complete');
    expect(completeCalls).toHaveLength(1);
  });
});

describe('workflow.complete — Needs human review escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits workflow.complete with success: false when engineer fails to implement', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult({ success: false }));

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['success']).toBe(false);
    expect(payload['terminalStep']).toBe('needs-human-review');
  });

  it('emits workflow.complete with success: false when refactor loop cap is exceeded', async () => {
    const ctxBase = makeCtxBase({ refactorLoopCap: 0 });
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(
      successResult({ success: false, artefacts: { comments: ['fix x'] } }),
    );

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['success']).toBe(false);
    expect(payload['terminalStep']).toBe('needs-human-review');
  });

  it('emits workflow.complete with mrUrl when CI cap is exceeded after MR is open', async () => {
    const ctxBase = makeCtxBase({ ciRetryCap: 1 });
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());
    vi.mocked(ctxBase.gitlab.getPipelineStatus).mockResolvedValue('failed');

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['success']).toBe(false);
    expect(payload['terminalStep']).toBe('needs-human-review');
    expect(payload['mrUrl']).toBe('https://gitlab.example.com/mr/1');
  });

  it('includes totalCostUsd from history on escalation paths', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult({ success: false, costUsd: 0.15 }));

    const history = [
      makeStepRow({ step: 'assess-clarification', sessionId: 'sess_0', costUsd: 0.15 }),
    ];
    const state = makeState(history);

    await runStory({ issueKey: 'ENG-1', state, ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['totalCostUsd']).toBeCloseTo(0.15);
  });

  it('emits workflow.complete even when assess-clarification fails (no branchName yet)', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValueOnce(successResult({ success: false, artefacts: {} }));

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    expect(findCompleteCall()).toBeDefined();
    const [, payload] = findCompleteCall()!;
    expect(payload['success']).toBe(false);
    expect(payload['mrUrl']).toBeUndefined();
  });
});

describe('workflow.complete — Clarification Needed halt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits workflow.complete with terminalStep: clarification-pending', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValueOnce(
      successResult({ artefacts: { questionsRequired: true, questions: 'What is the scope?' } }),
    );

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['terminalStep']).toBe('clarification-pending');
    expect(payload['success']).toBe(false);
  });

  it('does not include mrUrl in the clarification halt payload', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValueOnce(
      successResult({ artefacts: { questionsRequired: true, questions: 'Scope?' } }),
    );

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['mrUrl']).toBeUndefined();
  });

  it('includes partial cost incurred before the halt', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValueOnce(
      successResult({ costUsd: 0.05, artefacts: { questionsRequired: true, questions: 'Scope?' } }),
    );

    const history = [
      makeStepRow({ step: 'assess-clarification', sessionId: 'sess_0', costUsd: 0.05 }),
    ];
    const state = makeState(history);

    await runStory({ issueKey: 'ENG-1', state, ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['totalCostUsd']).toBeCloseTo(0.05);
  });
});

describe('workflow.complete — issueKey and payload shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always includes issueKey in the payload', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    await runStory({ issueKey: 'CREW-42', state: makeState(), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['issueKey']).toBe('CREW-42');
  });

  it('payload shape contains all required fields', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    await runStory({ issueKey: 'ENG-1', state: makeState(), ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload).toMatchObject({
      issueKey: expect.any(String),
      terminalStep: expect.any(String),
      success: expect.any(Boolean),
      totalCostUsd: expect.any(Number),
      stepCount: expect.any(Number),
      agentSteps: expect.any(Array),
      durationMs: expect.any(Number),
    });
  });

  it('costUsd null in a step row contributes 0 to totalCostUsd', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const history = [makeStepRow({ step: 'implement', sessionId: 'sess_1', costUsd: null })];
    const state = makeState(history);

    await runStory({ issueKey: 'ENG-1', state, ...ctxBase });

    const [, payload] = findCompleteCall()!;
    expect(payload['totalCostUsd']).toBe(0);
  });
});

describe('workflow.complete — addressFeedback escalation paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits workflow.complete with success: false when engineer fails to address MR feedback', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult({ success: false }));

    await addressFeedback(
      { issueKey: 'ENG-1', state: makeState(), ...ctxBase },
      'Please fix the type error',
      'https://gitlab.example.com/mr/1',
    );

    const call = findCompleteCall();
    expect(call).toBeDefined();
    const [, payload] = call!;
    expect(payload['success']).toBe(false);
    expect(payload['terminalStep']).toBe('needs-human-review');
    expect(payload['mrUrl']).toBe('https://gitlab.example.com/mr/1');
  });

  it('emits workflow.complete with success: false when addressFeedback throws unexpectedly', async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockRejectedValue(new Error('SDK unavailable'));

    await addressFeedback(
      { issueKey: 'ENG-1', state: makeState(), ...ctxBase },
      'Please fix the type error',
      'https://gitlab.example.com/mr/2',
    );

    const call = findCompleteCall();
    expect(call).toBeDefined();
    const [, payload] = call!;
    expect(payload['success']).toBe(false);
    expect(payload['mrUrl']).toBe('https://gitlab.example.com/mr/2');
  });
});
