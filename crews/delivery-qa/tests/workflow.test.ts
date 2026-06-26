import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent, AgentInput, AgentResult } from '@daddia/crew';

vi.mock('../src/observability.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  tracer: {
    startActiveSpan: vi.fn((_name: string, fn: (span: { setAttribute: () => void; end: () => void }) => unknown) =>
      fn({ setAttribute: vi.fn(), end: vi.fn() }),
    ),
  },
}));

vi.mock('../src/agents/qa-engineer/agent.js', () => ({
  qaEngineer: { name: 'qa-engineer', run: vi.fn() },
}));

import { runQaWorkflow } from '../src/workflow.js';
import type { WorkflowCtxBase } from '../src/workflow.js';
import { qaEngineer } from '../src/agents/qa-engineer/agent.js';
import { QaWorkspaceError } from '../src/qa-workspace.js';
import type { StateStore, Step, StepRow } from '../src/state.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';
import type { QaWorkspacePort } from '../src/qa-workspace.js';

const mockQaEngineer = vi.mocked(qaEngineer.run);

function makeJiraMock(): JiraClient {
  return {
    transitionIssue: vi.fn().mockResolvedValue(true),
    commentOnIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn().mockResolvedValue({
      summary: 'QA Story',
      description: 'Validate the feature.',
      acceptanceCriteria: 'Given a user When they login Then they see dashboard',
    }),
    searchIssues: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
  };
}

function makeGitlabMock(overrides: Partial<GitlabClient> = {}): GitlabClient {
  return {
    findOpenMrForIssue: vi.fn().mockResolvedValue('https://gitlab.example.com/mr/7'),
    getMrSourceBranch: vi.fn().mockResolvedValue('feature/CREW-99-test'),
    getPipelineStatus: vi.fn().mockResolvedValue('success'),
    ...overrides,
  };
}

function makeWorkspaceMock(overrides: Partial<QaWorkspacePort> = {}): QaWorkspacePort {
  return {
    checkoutMrRef: vi.fn().mockResolvedValue(undefined),
    runDeployScript: vi.fn().mockResolvedValue(undefined),
    runTestCommand: vi.fn().mockResolvedValue({ exitCode: 0, output: 'all tests passed' }),
    ...overrides,
  };
}

function makeCtxBase(
  behaviourOverrides: Partial<WorkflowCtxBase['behaviour']> = {},
): WorkflowCtxBase & {
  jira: ReturnType<typeof makeJiraMock>;
  gitlab: ReturnType<typeof makeGitlabMock>;
} {
  const jira = makeJiraMock();
  const gitlab = makeGitlabMock();
  return {
    behaviour: {
      qaDefectLoopCap: 2,
      remediationTimeoutHours: 48,
      externalIntegrationMode: 'mock',
      automatedTestCommand: 'pnpm test',
      qaEngineerMaxTurns: 40,
      qaEngineerCostCapUsd: 4,
      ...behaviourOverrides,
    },
    jira,
    gitlab,
    qaWorkspaceDir: '/qa-workspace',
  };
}

function makeState(): StateStore & { stepHistory: StepRow[] } {
  const stepHistory: StepRow[] = [];

  return {
    stepHistory,
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn((issueKey: string, step: Step, sessionId?: string) => {
      stepHistory.push({
        issueKey,
        step,
        sessionId: sessionId ?? null,
        startedAt: Date.now(),
        finishedAt: null,
        costUsd: null,
        verdict: null,
      });
    }),
    finishStep: vi.fn((issueKey: string, step: Step, result: { costUsd?: number; verdict: string | null }) => {
      const row = stepHistory.find((r) => r.step === step && r.finishedAt === null);
      if (row) {
        row.finishedAt = Date.now();
        row.costUsd = result.costUsd ?? null;
        row.verdict = result.verdict;
      }
    }),
    getStepHistory: vi.fn(() => stepHistory),
    countStepOccurrences: vi.fn().mockReturnValue(0),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    ping: vi.fn(),
    close: vi.fn(),
  };
}

function passResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    summary: 'ok',
    artefacts: { sessionId: 'sess-qa-1', verdict: 'pass' },
    costUsd: 0.02,
    ...overrides,
  };
}

describe('runQaWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQaEngineer.mockResolvedValue(passResult());
  });

  it('advances through deploy-qa, automated-suite, and exploratory-pass on happy path', async () => {
    const ctxBase = makeCtxBase();
    const workspace = makeWorkspaceMock();
    const state = makeState();

    await runQaWorkflow(
      { issueKey: 'CREW-99', state, ...ctxBase },
      { workspace, agents: { qaEngineer: { name: 'qa-engineer', run: mockQaEngineer } } },
    );

    const finishedSteps = state.stepHistory.map((r) => r.step);
    expect(finishedSteps).toContain('deploy-qa');
    expect(finishedSteps).toContain('automated-suite');
    expect(finishedSteps).toContain('exploratory-pass');
    expect(finishedSteps).toContain('external-integration');
    expect(ctxBase.jira.transitionIssue).not.toHaveBeenCalledWith('CREW-99', 'Needs human review');
  });

  it('writes stories row before each agent.run call', async () => {
    const ctxBase = makeCtxBase();
    const workspace = makeWorkspaceMock();
    const state = makeState();
    const upsertBeforeRun: Array<{ step: Step; ok: boolean }> = [];

    const trackingAgent: Agent = {
      name: 'qa-engineer',
      async run(input: AgentInput) {
        const task = input.context['task'];
        const upsertSteps = vi.mocked(state.upsertStory).mock.calls.map((c) => c[1]);
        const stepForTask =
          task === 'deploy-qa'
            ? 'deploy-qa'
            : task === 'run-automated-suite'
              ? 'automated-suite'
              : 'exploratory-pass';
        upsertBeforeRun.push({
          step: stepForTask,
          ok: upsertSteps.includes(stepForTask),
        });
        return passResult({ artefacts: { sessionId: `sess-${String(task)}`, verdict: 'pass' } });
      },
    };

    await runQaWorkflow(
      { issueKey: 'CREW-99', state, ...ctxBase },
      { workspace, agents: { qaEngineer: trackingAgent } },
    );

    expect(upsertBeforeRun).toEqual([
      { step: 'deploy-qa', ok: true },
      { step: 'automated-suite', ok: true },
      { step: 'exploratory-pass', ok: true },
    ]);
  });

  it('escalates when pipeline is not green at context-seed', async () => {
    const ctxBase = makeCtxBase();
    ctxBase.gitlab = makeGitlabMock({
      getPipelineStatus: vi.fn().mockResolvedValue('failed'),
    });
    const workspace = makeWorkspaceMock();
    const state = makeState();

    await runQaWorkflow(
      { issueKey: 'CREW-99', state, ...ctxBase },
      { workspace, agents: { qaEngineer: { name: 'qa-engineer', run: mockQaEngineer } } },
    );

    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'Needs human review');
    expect(workspace.checkoutMrRef).not.toHaveBeenCalled();
    expect(mockQaEngineer).not.toHaveBeenCalled();

    const finishedSteps = state.stepHistory.map((r) => r.step);
    expect(finishedSteps).not.toContain('deploy-qa');
  });

  it('escalates on deploy checkout failure without recording document-defects', async () => {
    const ctxBase = makeCtxBase();
    const workspace = makeWorkspaceMock({
      checkoutMrRef: vi.fn().mockRejectedValue(new QaWorkspaceError('repository not found')),
    });
    const state = makeState();

    await runQaWorkflow(
      { issueKey: 'CREW-99', state, ...ctxBase },
      { workspace, agents: { qaEngineer: { name: 'qa-engineer', run: mockQaEngineer } } },
    );

    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'Needs human review');
    expect(mockQaEngineer).not.toHaveBeenCalled();

    const finishedSteps = state.stepHistory.map((r) => r.step);
    expect(finishedSteps).not.toContain('document-defects');
  });
});
