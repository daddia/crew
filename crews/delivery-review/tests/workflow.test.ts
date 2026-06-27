import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Agent, AgentInput, AgentResult } from '@daddia/crew';

vi.mock('../src/observability.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  tracer: {
    startActiveSpan: vi.fn(
      (_name: string, fn: (span: { setAttribute: () => void; end: () => void }) => unknown) =>
        fn({ setAttribute: vi.fn(), end: vi.fn() }),
    ),
  },
}));

vi.mock('../src/agents/tech-lead/agent.js', () => ({
  techLead: { name: 'tech-lead', run: vi.fn() },
}));

import { runReviewWorkflow } from '../src/workflow.js';
import { techLead } from '../src/agents/tech-lead/agent.js';
import { log } from '../src/observability.js';
import type { StateStore, Step, StepRow } from '../src/state.js';
import type { JiraClient } from '../src/integrations/jira.js';
import type { GitlabClient } from '../src/integrations/gitlab.js';
import type { WorkflowContext } from '../src/workflow.js';

const mockTechLead = vi.mocked(techLead.run);
const MR_URL = 'https://gitlab.example.com/group/project/-/merge_requests/42';

let testDbPath: string;

function makeTestDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dr-workflow-test-')), 'test.db');
}

function makeJiraMock(): JiraClient {
  return {
    transitionIssue: vi.fn().mockResolvedValue(true),
    commentOnIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn().mockResolvedValue({
      summary: 'Review Story',
      description: 'Deliver the feature.',
      acceptanceCriteria: 'Given a user When they act Then outcome holds',
    }),
    getIssueStatus: vi.fn().mockResolvedValue('In Review'),
    getComments: vi.fn().mockResolvedValue([]),
    searchIssues: vi.fn().mockResolvedValue([]),
  };
}

function makeGitlabMock(overrides: Partial<GitlabClient> = {}): GitlabClient {
  return {
    findOpenMrForIssue: vi.fn().mockResolvedValue(MR_URL),
    findMrForIssue: vi.fn().mockResolvedValue({ mrUrl: MR_URL, state: 'opened' }),
    getMrSourceBranch: vi.fn().mockResolvedValue('feature/CREW-99-review'),
    getPipelineStatus: vi.fn().mockResolvedValue('success'),
    getMrDiff: vi.fn().mockResolvedValue(''),
    approveMergeRequest: vi.fn().mockResolvedValue(undefined),
    mergeMergeRequest: vi.fn().mockResolvedValue('abc123merge'),
    ...overrides,
  };
}

function makeBehaviour(): WorkflowContext['behaviour'] {
  return {
    pmReviewTimeoutHours: 48,
    pmApprovalCommentPattern: '/pm-approve',
    techLeadMaxTurns: 30,
    techLeadCostCapUsd: 5,
    diffFileCap: 50,
    diffSizeCapBytes: 500_000,
  };
}

function makeState(): StateStore & {
  stepHistory: StepRow[];
  stories: Map<string, { currentStep: Step; startedAt: number }>;
  upsertStory: ReturnType<typeof vi.fn>;
} {
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
      return story
        ? { issueKey, currentStep: story.currentStep, startedAt: story.startedAt }
        : undefined;
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
    finishStep: vi.fn(
      (issueKey: string, step: Step, result: { costUsd?: number; verdict: string | null }) => {
        const row = stepHistory.find((r) => r.step === step && r.finishedAt === null);
        if (row) {
          row.finishedAt = Date.now();
          row.costUsd = result.costUsd ?? null;
          row.verdict = result.verdict;
        }
      },
    ),
    getStepHistory: vi.fn(() => stepHistory),
    countStepOccurrences: vi.fn(
      (issueKey: string, step: Step) =>
        stepHistory.filter((r) => r.issueKey === issueKey && r.step === step).length,
    ),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    ping: vi.fn(),
    close: vi.fn(),
  };
}

function approveResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    summary: 'Final review approved.',
    artefacts: {
      sessionId: 'sess-tl-1',
      verdict: 'approve',
      blockers: [],
      warnings: [],
      acCoverage: [{ criterion: 'Feature works', status: 'met' }],
    },
    costUsd: 0.04,
    ...overrides,
  };
}

function blockResult(
  blockers: Array<{ category: string; summary: string; filePath?: string }>,
): AgentResult {
  return {
    success: false,
    summary: 'Final review blocked.',
    artefacts: {
      sessionId: 'sess-tl-block',
      verdict: 'block',
      blockers,
    },
    costUsd: 0.03,
  };
}

function makeCtx(
  overrides: {
    jira?: ReturnType<typeof makeJiraMock>;
    gitlab?: ReturnType<typeof makeGitlabMock>;
    state?: ReturnType<typeof makeState>;
  } = {},
): WorkflowContext & {
  jira: ReturnType<typeof makeJiraMock>;
  gitlab: ReturnType<typeof makeGitlabMock>;
  state: ReturnType<typeof makeState>;
} {
  const jira = overrides.jira ?? makeJiraMock();
  const gitlab = overrides.gitlab ?? makeGitlabMock();
  const state = overrides.state ?? makeState();

  return {
    issueKey: 'CREW-99',
    state,
    dbPath: testDbPath,
    behaviour: makeBehaviour(),
    jira,
    gitlab,
  };
}

describe('runReviewWorkflow', () => {
  beforeEach(() => {
    testDbPath = makeTestDbPath();
    vi.clearAllMocks();
    mockTechLead.mockResolvedValue(approveResult());
  });

  afterEach(() => {
    rmSync(join(testDbPath, '..'), { recursive: true, force: true });
  });

  it('reaches stakeholder-review-pending after approving review (happy path)', async () => {
    const ctx = makeCtx();
    const logInfo = vi.spyOn(log, 'info');

    await runReviewWorkflow(ctx, {
      agents: { techLead: { name: 'tech-lead', run: mockTechLead } },
    });

    expect(ctx.state.getStory('CREW-99')?.currentStep).toBe('stakeholder-review-pending');
    expect(ctx.jira.commentOnIssue).toHaveBeenCalledWith(
      'CREW-99',
      expect.stringContaining('/pm-approve'),
    );
    expect(logInfo).toHaveBeenCalledWith('workflow.blocked.stakeholder-review', {
      issueKey: 'CREW-99',
      mrUrl: MR_URL,
    });
    expect(ctx.gitlab.approveMergeRequest).not.toHaveBeenCalled();
    expect(ctx.gitlab.mergeMergeRequest).not.toHaveBeenCalled();
  });

  it('escalates on review blockers without entering PM gate', async () => {
    const ctx = makeCtx();
    mockTechLead.mockResolvedValue(
      blockResult([
        {
          category: 'architecture',
          summary: 'Circular dependency in module graph',
          filePath: 'src/a.ts',
        },
      ]),
    );

    await runReviewWorkflow(ctx, {
      agents: { techLead: { name: 'tech-lead', run: mockTechLead } },
    });

    expect(ctx.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'Needs human review');
    expect(ctx.state.getStory('CREW-99')?.currentStep).toBe('needs-human-review');
    expect(ctx.jira.commentOnIssue).toHaveBeenCalledWith(
      'CREW-99',
      expect.stringContaining('Final code review blocked'),
    );
    expect(ctx.gitlab.approveMergeRequest).not.toHaveBeenCalled();
    expect(ctx.gitlab.mergeMergeRequest).not.toHaveBeenCalled();
  });

  it('escalates when pipeline is not green at context-seed without invoking tech-lead', async () => {
    const gitlab = makeGitlabMock({
      getPipelineStatus: vi.fn().mockResolvedValue('failed'),
    });
    const ctx = makeCtx({ gitlab });

    await runReviewWorkflow(ctx, {
      agents: { techLead: { name: 'tech-lead', run: mockTechLead } },
    });

    expect(ctx.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'Needs human review');
    expect(mockTechLead).not.toHaveBeenCalled();
  });

  it('escalates when no open MR at context-seed without invoking tech-lead', async () => {
    const gitlab = makeGitlabMock({
      findOpenMrForIssue: vi.fn().mockResolvedValue(null),
    });
    const ctx = makeCtx({ gitlab });

    await runReviewWorkflow(ctx, {
      agents: { techLead: { name: 'tech-lead', run: mockTechLead } },
    });

    expect(ctx.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'Needs human review');
    expect(ctx.state.getStory('CREW-99')?.currentStep).toBe('needs-human-review');
    expect(mockTechLead).not.toHaveBeenCalled();
  });

  it('escalates on agent run failure without entering PM gate', async () => {
    const ctx = makeCtx();
    mockTechLead.mockResolvedValue({
      success: false,
      summary: 'SDK session error',
      artefacts: { sessionId: 'sess-tl-fail' },
      costUsd: 0,
    });

    await runReviewWorkflow(ctx, {
      agents: { techLead: { name: 'tech-lead', run: mockTechLead } },
    });

    expect(ctx.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'Needs human review');
    expect(ctx.state.getStory('CREW-99')?.currentStep).toBe('needs-human-review');
    expect(ctx.gitlab.approveMergeRequest).not.toHaveBeenCalled();
    expect(ctx.gitlab.mergeMergeRequest).not.toHaveBeenCalled();
  });

  it('writes upsertStory before agent.run for final-code-review', async () => {
    const state = makeState();
    const ctx = makeCtx({ state });
    const upsertOrder: string[] = [];

    state.upsertStory.mockImplementation((issueKey: string, step: Step) => {
      upsertOrder.push(`upsert:${step}`);
      const existing = state.stories.get(issueKey);
      if (!existing) {
        state.stories.set(issueKey, { currentStep: step, startedAt: Date.now() });
      } else {
        existing.currentStep = step;
      }
    });

    mockTechLead.mockImplementation(async () => {
      upsertOrder.push('agent.run');
      return approveResult();
    });

    await runReviewWorkflow(ctx, {
      agents: { techLead: { name: 'tech-lead', run: mockTechLead } },
    });

    const finalReviewUpsertIdx = upsertOrder.indexOf('upsert:final-code-review');
    const agentRunIdx = upsertOrder.indexOf('agent.run');
    expect(finalReviewUpsertIdx).toBeGreaterThanOrEqual(0);
    expect(agentRunIdx).toBeGreaterThan(finalReviewUpsertIdx);
    expect(state.upsertStory).toHaveBeenCalledWith('CREW-99', 'final-code-review');
  });

  it('resumes at merge-and-close and transitions to Done after PM approval (CREW-06-06)', async () => {
    const state = makeState();
    state.stories.set('CREW-99', {
      currentStep: 'stakeholder-review-pending',
      startedAt: Date.now() - 60_000,
    });
    state.getStepHistory.mockReturnValue([
      {
        issueKey: 'CREW-99',
        step: 'final-code-review',
        sessionId: 'sess-tl-1',
        startedAt: Date.now() - 120_000,
        finishedAt: Date.now() - 90_000,
        costUsd: 0.04,
        verdict: 'approve',
      },
    ]);

    mockTechLead.mockResolvedValue({
      success: true,
      summary: 'Posted review summary comment.',
      artefacts: { sessionId: 'sess-summary', verdict: 'approve' },
      costUsd: 0.01,
    });

    const ctx = makeCtx({ state });
    const logInfo = vi.spyOn(log, 'info');

    await runReviewWorkflow(ctx, {
      resumeFromMerge: true,
      agents: { techLead: { name: 'tech-lead', run: mockTechLead } },
    });

    expect(ctx.gitlab.approveMergeRequest).toHaveBeenCalledWith(MR_URL);
    expect(ctx.gitlab.mergeMergeRequest).toHaveBeenCalledWith(MR_URL);
    expect(ctx.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'Done');
    expect(ctx.state.getStory('CREW-99')?.currentStep).toBe('done');
    expect(logInfo).toHaveBeenCalledWith('workflow.handoff-done', {
      issueKey: 'CREW-99',
      mrUrl: MR_URL,
      mergeCommitSha: 'abc123merge',
    });
    expect(mockTechLead).toHaveBeenCalledWith(
      expect.objectContaining({
        issueKey: 'CREW-99',
        context: expect.objectContaining({ task: 'publish-review-summary' }),
      }),
    );
  });

  it('escalates when pipeline is not green at merge-and-close resume', async () => {
    const state = makeState();
    state.stories.set('CREW-99', {
      currentStep: 'stakeholder-review-pending',
      startedAt: Date.now() - 60_000,
    });
    const gitlab = makeGitlabMock({
      getPipelineStatus: vi.fn().mockResolvedValue('failed'),
    });
    const ctx = makeCtx({ state, gitlab });

    await runReviewWorkflow(ctx, {
      resumeFromMerge: true,
      agents: { techLead: { name: 'tech-lead', run: mockTechLead } },
    });

    expect(ctx.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'Needs human review');
    expect(ctx.gitlab.approveMergeRequest).not.toHaveBeenCalled();
    expect(ctx.gitlab.mergeMergeRequest).not.toHaveBeenCalled();
    expect(mockTechLead).not.toHaveBeenCalled();
  });

  it('transitions to Done and logs handoff-done when summary publication fails after merge', async () => {
    const state = makeState();
    state.stories.set('CREW-99', {
      currentStep: 'stakeholder-review-pending',
      startedAt: Date.now() - 60_000,
    });
    state.getStepHistory.mockReturnValue([
      {
        issueKey: 'CREW-99',
        step: 'final-code-review',
        sessionId: 'sess-tl-1',
        startedAt: Date.now() - 120_000,
        finishedAt: Date.now() - 90_000,
        costUsd: 0.04,
        verdict: 'approve',
      },
    ]);

    mockTechLead.mockResolvedValue({
      success: false,
      summary: 'Failed to post Jira comment',
      artefacts: { sessionId: 'sess-summary' },
      costUsd: 0.01,
    });

    const ctx = makeCtx({ state });
    const logInfo = vi.spyOn(log, 'info');
    const logWarn = vi.spyOn(log, 'warn');

    await runReviewWorkflow(ctx, {
      resumeFromMerge: true,
      agents: { techLead: { name: 'tech-lead', run: mockTechLead } },
    });

    expect(ctx.gitlab.mergeMergeRequest).toHaveBeenCalledWith(MR_URL);
    expect(ctx.jira.transitionIssue).toHaveBeenCalledWith('CREW-99', 'Done');
    expect(ctx.state.getStory('CREW-99')?.currentStep).toBe('done');
    expect(logInfo).toHaveBeenCalledWith('workflow.handoff-done', {
      issueKey: 'CREW-99',
      mrUrl: MR_URL,
      mergeCommitSha: 'abc123merge',
    });
    expect(logWarn).toHaveBeenCalledWith(
      'workflow.merge-and-close.summary-failed',
      expect.objectContaining({ issueKey: 'CREW-99', mergeCommitSha: 'abc123merge' }),
    );
    expect(ctx.jira.transitionIssue).not.toHaveBeenCalledWith('CREW-99', 'Needs human review');
  });
});
