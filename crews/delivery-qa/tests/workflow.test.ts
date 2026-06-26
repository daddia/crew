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

import { runQaWorkflow, watchRemediationTimeouts } from '../src/workflow.js';
import type { WorkflowCtxBase } from '../src/workflow.js';
import { qaEngineer } from '../src/agents/qa-engineer/agent.js';
import { log } from '../src/observability.js';
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
    addLabel: vi.fn().mockResolvedValue(undefined),
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

function makeState(): StateStore & { stepHistory: StepRow[]; stories: Map<string, { currentStep: Step; startedAt: number }> } {
  const stepHistory: StepRow[] = [];
  const stories = new Map<string, { currentStep: Step; startedAt: number }>();

  return {
    stepHistory,
    stories,
    upsertStory: vi.fn((issueKey: string, step: Step) => {
      const existing = stories.get(issueKey);
      if (!existing) {
        stories.set(issueKey, { currentStep: step, startedAt: Date.now() });
      } else {
        existing.currentStep = step;
      }
    }),
    getStory: vi.fn((issueKey: string) => {
      const story = stories.get(issueKey);
      return story ? { issueKey, currentStep: story.currentStep, startedAt: story.startedAt } : undefined;
    }),
    getStoriesAtStep: vi.fn((step: Step) => {
      const results: Array<{ issueKey: string; currentStep: Step; startedAt: number }> = [];
      for (const [issueKey, story] of stories) {
        if (story.currentStep === step) {
          results.push({ issueKey, currentStep: story.currentStep, startedAt: story.startedAt });
        }
      }
      return results;
    }),
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
    countStepOccurrences: vi.fn((issueKey: string, step: Step) =>
      stepHistory.filter((r) => r.issueKey === issueKey && r.step === step).length,
    ),
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

const sampleDefect = {
  id: 'DEF-1',
  severity: 'major' as const,
  summary: 'Login button missing',
  stepsToReproduce: 'Open login page',
  expected: 'Login button visible',
  observed: 'Button not rendered',
};

function failWithDefectsResult(): AgentResult {
  return {
    success: false,
    summary: 'Product test failure',
    artefacts: {
      sessionId: 'sess-qa-fail',
      verdict: 'fail',
      defects: [sampleDefect],
    },
    costUsd: 0.03,
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
    expect(finishedSteps).toContain('in-review');
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'In Review');
    expect(ctxBase.jira.transitionIssue).not.toHaveBeenCalledWith('CREW-99', 'Needs human review');
    expect(state.stories.get('CREW-99')?.currentStep).toBe('in-review');
  });

  it('emits workflow.handoff-to-review log after transitioning to In Review', async () => {
    const ctxBase = makeCtxBase();
    const workspace = makeWorkspaceMock();
    const state = makeState();

    await runQaWorkflow(
      { issueKey: 'CREW-42', state, ...ctxBase },
      { workspace, agents: { qaEngineer: { name: 'qa-engineer', run: mockQaEngineer } } },
    );

    expect(vi.mocked(log.info)).toHaveBeenCalledWith(
      'workflow.handoff-to-review',
      expect.objectContaining({
        issueKey: 'CREW-42',
        mrUrl: 'https://gitlab.example.com/mr/7',
      }),
    );
  });

  it('persists per-step cost_usd for agent steps on happy path', async () => {
    const ctxBase = makeCtxBase();
    const workspace = makeWorkspaceMock();
    const state = makeState();

    mockQaEngineer.mockImplementation(async (input: AgentInput) => {
      const task = input.context['task'];
      const costByTask: Record<string, number> = {
        'deploy-qa': 0.01,
        'run-automated-suite': 0.02,
        'exploratory-pass': 0.03,
      };
      return passResult({
        costUsd: costByTask[String(task)] ?? 0,
        artefacts: { sessionId: `sess-${String(task)}`, verdict: 'pass' },
      });
    });

    await runQaWorkflow(
      { issueKey: 'CREW-99', state, ...ctxBase },
      { workspace, agents: { qaEngineer: { name: 'qa-engineer', run: mockQaEngineer } } },
    );

    const agentSteps = state.stepHistory.filter((r) => r.sessionId !== null);
    expect(agentSteps.length).toBeGreaterThanOrEqual(3);
    for (const row of agentSteps) {
      expect(row.costUsd).not.toBeNull();
      expect(row.costUsd).toBeGreaterThan(0);
    }
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

  it('hands off structured defects to Jira when automated-suite finds product failures', async () => {
    const ctxBase = makeCtxBase({ qaDefectLoopCap: 2 });
    const workspace = makeWorkspaceMock({
      runTestCommand: vi.fn().mockResolvedValue({ exitCode: 1, output: '1 test failed' }),
    });
    const state = makeState();

    mockQaEngineer.mockImplementation(async (input: AgentInput) => {
      const task = input.context['task'];
      if (task === 'run-automated-suite') {
        return failWithDefectsResult();
      }
      if (task === 'document-defects') {
        return failWithDefectsResult();
      }
      return passResult({ artefacts: { sessionId: `sess-${String(task)}`, verdict: 'pass' } });
    });

    await runQaWorkflow(
      { issueKey: 'CREW-99', state, ...ctxBase },
      { workspace, agents: { qaEngineer: { name: 'qa-engineer', run: mockQaEngineer } } },
    );

    expect(ctxBase.jira.commentOnIssue).toHaveBeenCalledWith(
      'CREW-99',
      expect.stringContaining('DEF-1'),
    );
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'In Remediation');
    expect(ctxBase.jira.addLabel).toHaveBeenCalledWith('CREW-99', 'qa-remediation');

    expect(vi.mocked(log.info)).toHaveBeenCalledWith(
      'workflow.remediation-required',
      expect.objectContaining({ issueKey: 'CREW-99', defectCount: 1 }),
    );

    const finishedSteps = state.stepHistory.map((r) => r.step);
    expect(finishedSteps).toContain('document-defects');
    expect(finishedSteps).toContain('remediation-handoff');
    expect(finishedSteps).toContain('remediation-pending');
    expect(state.stories.get('CREW-99')?.currentStep).toBe('remediation-pending');
  });

  it('escalates when defect loop cap is zero', async () => {
    const ctxBase = makeCtxBase({ qaDefectLoopCap: 0 });
    const workspace = makeWorkspaceMock({
      runTestCommand: vi.fn().mockResolvedValue({ exitCode: 1, output: '1 test failed' }),
    });
    const state = makeState();

    mockQaEngineer.mockImplementation(async (input: AgentInput) => {
      const task = input.context['task'];
      if (task === 'run-automated-suite') {
        return failWithDefectsResult();
      }
      return passResult({ artefacts: { sessionId: `sess-${String(task)}`, verdict: 'pass' } });
    });

    await expect(
      runQaWorkflow(
        { issueKey: 'CREW-99', state, ...ctxBase },
        { workspace, agents: { qaEngineer: { name: 'qa-engineer', run: mockQaEngineer } } },
      ),
    ).resolves.toBeUndefined();

    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'Needs human review');
    expect(ctxBase.jira.transitionIssue).not.toHaveBeenCalledWith('CREW-99', 'In Remediation');

    const finishedSteps = state.stepHistory.map((r) => r.step);
    expect(finishedSteps).not.toContain('remediation-handoff');
  });

  it('escalates remediation-pending stories after timeout', async () => {
    const ctxBase = makeCtxBase({ remediationTimeoutHours: 48 });
    const state = makeState();
    const staleStartedAt = Date.now() - 49 * 60 * 60 * 1000;
    state.stories.set('CREW-55', { currentStep: 'remediation-pending', startedAt: staleStartedAt });

    await watchRemediationTimeouts({ state, ...ctxBase });

    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith('CREW-55', 'Needs human review');
    expect(state.stories.get('CREW-55')?.currentStep).toBe('needs-human-review');
  });
});
