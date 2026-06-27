import type { Agent, AgentInput, AgentResult } from '@daddia/crew';
import { techLead } from './agents/tech-lead/agent.js';
import type { Config } from './config.js';
import type { GitlabClient } from './integrations/gitlab.js';
import type { JiraClient, JiraIssue } from './integrations/jira.js';
import { log, tracer } from './observability.js';
import type { StateStore, Step } from './state.js';

/** Default model for tech-lead runs until dedicated routing lands. */
const TECH_LEAD_MODEL = 'claude-sonnet-4-6';

export interface WorkflowContext {
  issueKey: string;
  state: StateStore;
  behaviour: Pick<
    Config['behaviour'],
    | 'pmReviewTimeoutHours'
    | 'pmApprovalCommentPattern'
    | 'techLeadMaxTurns'
    | 'techLeadCostCapUsd'
    | 'diffFileCap'
    | 'diffSizeCapBytes'
  >;
  jira: JiraClient;
  gitlab: GitlabClient;
}

export type WorkflowCtxBase = Omit<WorkflowContext, 'issueKey' | 'state'>;

export interface WorkflowAgents {
  techLead: Agent;
}

export interface RunReviewWorkflowOptions {
  agents?: WorkflowAgents;
  /** When true, resume at merge-and-close after PM approval (poller dispatch). */
  resumeFromMerge?: boolean;
}

interface ReviewSeedContext {
  ticket: JiraIssue | null;
  mrUrl: string;
  branchName: string;
  pipelineStatus: string;
  acceptanceCriteria: string;
}

interface ReviewBlocker {
  category: string;
  summary: string;
  filePath?: string;
}

async function withWorkflowStepSpan<T>(
  stepName: Step,
  issueKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    'workflow.step',
    async (span: { setAttribute(key: string, value: string): void; end(): void }) => {
      span.setAttribute('workflow.step', stepName);
      span.setAttribute('issueKey', issueKey);
      try {
        return await fn();
      } finally {
        span.end();
      }
    },
  );
}

function techLeadContext(
  ctx: WorkflowContext,
  seed: ReviewSeedContext,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    model: TECH_LEAD_MODEL,
    maxTurns: ctx.behaviour.techLeadMaxTurns,
    techLeadCostCapUsd: ctx.behaviour.techLeadCostCapUsd,
    diffFileCap: ctx.behaviour.diffFileCap,
    diffSizeCapBytes: ctx.behaviour.diffSizeCapBytes,
    mrUrl: seed.mrUrl,
    branchName: seed.branchName,
    pipelineStatus: seed.pipelineStatus,
    acceptanceCriteria: seed.acceptanceCriteria,
    ...extra,
  };
}

function isReviewBlocker(value: unknown): value is ReviewBlocker {
  if (!value || typeof value !== 'object') return false;
  const blocker = value as Record<string, unknown>;
  return typeof blocker['category'] === 'string' && typeof blocker['summary'] === 'string';
}

function extractBlockers(result: AgentResult): ReviewBlocker[] {
  const raw = result.artefacts['blockers'];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isReviewBlocker);
}

function formatBlockerComment(blockers: ReviewBlocker[]): string {
  let body = '*Final code review blocked — action required*\n\n';
  for (const blocker of blockers) {
    const location = blocker.filePath ? ` (${blocker.filePath})` : '';
    body += `*${blocker.category}*${location}: ${blocker.summary}\n`;
  }
  return body.trimEnd();
}

function formatPmSignOffComment(approvalPattern: string): string {
  return (
    '*Stakeholder review required*\n\n' +
    'Tech-lead final code review passed. PM sign-off is required before merge.\n\n' +
    `Reply with \`${approvalPattern}\` to approve merging this MR.`
  );
}

function stepVerdict(result: AgentResult): string | undefined {
  const artefactVerdict = result.artefacts['verdict'];
  if (artefactVerdict === 'approve' || artefactVerdict === 'block') {
    return artefactVerdict;
  }
  return result.success ? 'ok' : 'failed';
}

async function runAgentStep(
  ctx: WorkflowContext,
  step: Step,
  input: AgentInput,
  agent: Agent,
): Promise<AgentResult> {
  const { issueKey, state } = ctx;
  state.upsertStory(issueKey, step);

  const result = await agent.run(input);

  const sessionId = result.artefacts['sessionId'] as string | undefined;
  state.startStep(issueKey, step, sessionId);
  state.finishStep(issueKey, step, {
    costUsd: result.costUsd,
    verdict: stepVerdict(result),
  });

  return result;
}

async function seedReviewContext(ctx: WorkflowContext): Promise<ReviewSeedContext | null> {
  const { issueKey, state, jira, gitlab } = ctx;

  return withWorkflowStepSpan('context-seed', issueKey, async () => {
    state.upsertStory(issueKey, 'context-seed');
    state.startStep(issueKey, 'context-seed');

    let ticket: JiraIssue | null = null;
    try {
      ticket = await jira.getIssue(issueKey);
    } catch (err) {
      log.warn('workflow.context-seed.failed', { issueKey, err: String(err) });
    }

    let mrUrl: string | null = null;
    try {
      mrUrl = await gitlab.findOpenMrForIssue(issueKey);
    } catch (err) {
      log.warn('workflow.context-seed.mr-failed', { issueKey, err: String(err) });
    }

    if (!mrUrl) {
      state.finishStep(issueKey, 'context-seed', { verdict: 'failed' });
      await escalateToHumanReview(jira, issueKey, 'No open merge request found for issue', state);
      return null;
    }

    let branchName: string;
    try {
      branchName = await gitlab.getMrSourceBranch(mrUrl);
    } catch (err) {
      log.warn('workflow.context-seed.branch-failed', { issueKey, mrUrl, err: String(err) });
      state.finishStep(issueKey, 'context-seed', { verdict: 'failed' });
      await escalateToHumanReview(
        jira,
        issueKey,
        'Failed to resolve MR source branch',
        state,
      );
      return null;
    }

    let pipelineStatus: string;
    try {
      pipelineStatus = await gitlab.getPipelineStatus(mrUrl);
    } catch (err) {
      log.warn('workflow.context-seed.pipeline-failed', { issueKey, mrUrl, err: String(err) });
      state.finishStep(issueKey, 'context-seed', { verdict: 'failed' });
      await escalateToHumanReview(jira, issueKey, 'Failed to read pipeline status', state);
      return null;
    }

    if (pipelineStatus !== 'success') {
      state.finishStep(issueKey, 'context-seed', { verdict: 'failed' });
      await escalateToHumanReview(
        jira,
        issueKey,
        `CI pipeline not green at review start (status: ${pipelineStatus})`,
        state,
      );
      return null;
    }

    const acceptanceCriteria = ticket?.acceptanceCriteria ?? '';

    state.finishStep(issueKey, 'context-seed', { verdict: 'ok' });
    return {
      ticket,
      mrUrl,
      branchName,
      pipelineStatus,
      acceptanceCriteria,
    };
  });
}

async function enterStakeholderReviewPending(
  ctx: WorkflowContext,
  seed: ReviewSeedContext,
): Promise<void> {
  const { issueKey, state, jira, behaviour } = ctx;

  await jira.commentOnIssue(
    issueKey,
    formatPmSignOffComment(behaviour.pmApprovalCommentPattern),
  );

  state.upsertStory(issueKey, 'stakeholder-review-pending');
  state.startStep(issueKey, 'stakeholder-review-pending');
  state.finishStep(issueKey, 'stakeholder-review-pending', { verdict: 'pending' });

  log.info('workflow.blocked.stakeholder-review', { issueKey, mrUrl: seed.mrUrl });
}

async function runReviewWorkflowInner(
  ctx: WorkflowContext,
  input: AgentInput,
  agents: WorkflowAgents,
): Promise<void> {
  const { issueKey, jira } = ctx;

  const seed = await seedReviewContext(ctx);
  if (!seed) {
    return;
  }

  const reviewResult = await runAgentStep(
    ctx,
    'final-code-review',
    {
      ...input,
      context: techLeadContext(ctx, seed, { task: 'final-code-review' }),
    },
    agents.techLead,
  );

  const verdict = reviewResult.artefacts['verdict'];

  if (verdict === 'block') {
    const blockers = extractBlockers(reviewResult);
    if (blockers.length > 0) {
      await jira.commentOnIssue(issueKey, formatBlockerComment(blockers));
    }
    await escalateToHumanReview(
      jira,
      issueKey,
      reviewResult.summary || 'Final code review blocked',
      ctx.state,
    );
    return;
  }

  if (!reviewResult.success) {
    await escalateToHumanReview(
      jira,
      issueKey,
      reviewResult.summary || 'Final code review step failed',
      ctx.state,
    );
    return;
  }

  await enterStakeholderReviewPending(ctx, seed);
}

function buildReviewSummary(result: AgentResult | undefined, mrUrl: string): string {
  if (result?.summary) {
    return result.summary;
  }

  const acCoverage = result?.artefacts['acCoverage'];
  if (Array.isArray(acCoverage) && acCoverage.length > 0) {
    const lines = acCoverage
      .filter(
        (entry): entry is { criterion: string; status: string } =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as { criterion?: unknown }).criterion === 'string' &&
          typeof (entry as { status?: unknown }).status === 'string',
      )
      .map((entry) => `- ${entry.criterion}: ${entry.status}`);
    if (lines.length > 0) {
      return ['Final code review approved.', ...lines].join('\n');
    }
  }

  return `Final code review approved. MR: ${mrUrl}`;
}

function priorReviewVerdictFromHistory(
  history: ReturnType<StateStore['getStepHistory']>,
): 'approve' | 'block' {
  const reviewStep = [...history].reverse().find((row) => row.step === 'final-code-review');
  if (reviewStep?.verdict === 'block') {
    return 'block';
  }
  return 'approve';
}

async function resolveResumeSeed(ctx: WorkflowContext): Promise<ReviewSeedContext | null> {
  const { issueKey, jira, gitlab } = ctx;

  let mrUrl: string | null = null;
  try {
    mrUrl = await gitlab.findOpenMrForIssue(issueKey);
  } catch (err) {
    log.warn('workflow.merge-and-close.mr-failed', { issueKey, err: String(err) });
  }

  if (!mrUrl) {
    await escalateToHumanReview(
      jira,
      issueKey,
      'No open merge request found at merge-and-close',
      ctx.state,
    );
    return null;
  }

  let branchName: string;
  try {
    branchName = await gitlab.getMrSourceBranch(mrUrl);
  } catch (err) {
    log.warn('workflow.merge-and-close.branch-failed', { issueKey, mrUrl, err: String(err) });
    await escalateToHumanReview(
      jira,
      issueKey,
      'Failed to resolve MR source branch at merge-and-close',
      ctx.state,
    );
    return null;
  }

  let pipelineStatus: string;
  try {
    pipelineStatus = await gitlab.getPipelineStatus(mrUrl);
  } catch (err) {
    log.warn('workflow.merge-and-close.pipeline-failed', { issueKey, mrUrl, err: String(err) });
    await escalateToHumanReview(jira, issueKey, 'Failed to read pipeline status before merge', ctx.state);
    return null;
  }

  if (pipelineStatus !== 'success') {
    await escalateToHumanReview(
      jira,
      issueKey,
      `CI pipeline not green before merge (status: ${pipelineStatus})`,
      ctx.state,
    );
    return null;
  }

  let ticket: JiraIssue | null = null;
  try {
    ticket = await jira.getIssue(issueKey);
  } catch (err) {
    log.warn('workflow.merge-and-close.issue-failed', { issueKey, err: String(err) });
  }

  return {
    ticket,
    mrUrl,
    branchName,
    pipelineStatus,
    acceptanceCriteria: ticket?.acceptanceCriteria ?? '',
  };
}

async function runMergeAndClose(ctx: WorkflowContext, agents: WorkflowAgents): Promise<void> {
  const { issueKey, state, jira, gitlab } = ctx;

  await withWorkflowStepSpan('merge-and-close', issueKey, async () => {
    state.upsertStory(issueKey, 'merge-and-close');

    const seed = await resolveResumeSeed(ctx);
    if (!seed) {
      state.startStep(issueKey, 'merge-and-close');
      state.finishStep(issueKey, 'merge-and-close', { verdict: 'failed' });
      return;
    }

    try {
      await gitlab.approveMergeRequest(seed.mrUrl);
      const mergeCommitSha = await gitlab.mergeMergeRequest(seed.mrUrl);

      const history = state.getStepHistory(issueKey);
      const reviewStep = [...history].reverse().find((row) => row.step === 'final-code-review');
      const previousSessionId = reviewStep?.sessionId ?? undefined;
      const priorReviewVerdict = priorReviewVerdictFromHistory(history);

      const summaryResult = await agents.techLead.run({
        issueKey,
        context: techLeadContext(ctx, seed, {
          task: 'publish-review-summary',
          previousSessionId,
          priorReviewVerdict,
          reviewSummary: buildReviewSummary(undefined, seed.mrUrl),
          mergeCommitSha,
        }),
      });

      const sessionId = summaryResult.artefacts['sessionId'] as string | undefined;
      state.startStep(issueKey, 'merge-and-close', sessionId);

      if (!summaryResult.success) {
        state.finishStep(issueKey, 'merge-and-close', { verdict: 'failed' });
        await escalateToHumanReview(
          jira,
          issueKey,
          summaryResult.summary || 'Failed to publish review summary after merge',
          state,
        );
        return;
      }

      await jira.transitionIssue(issueKey, 'Done');
      state.upsertStory(issueKey, 'done');
      state.finishStep(issueKey, 'merge-and-close', {
        costUsd: summaryResult.costUsd,
        verdict: 'ok',
      });
      log.info('workflow.handoff-done', {
        issueKey,
        mrUrl: seed.mrUrl,
        mergeCommitSha,
      });
    } catch (err) {
      log.error('workflow.merge-and-close.error', { issueKey, err: String(err) });
      state.startStep(issueKey, 'merge-and-close');
      state.finishStep(issueKey, 'merge-and-close', { verdict: 'failed' });
      await escalateToHumanReview(
        jira,
        issueKey,
        'GitLab approve or merge failed',
        state,
      );
    }
  });
}

async function runReviewWorkflowResume(ctx: WorkflowContext, agents: WorkflowAgents): Promise<void> {
  await runMergeAndClose(ctx, agents);
}

/**
 * Run the delivery-review sequence for one story through PM HITL entry.
 *
 * Sequence:
 *   context-seed → final-code-review → stakeholder-review-pending
 */
export async function runReviewWorkflow(
  ctx: WorkflowContext,
  options?: RunReviewWorkflowOptions,
): Promise<void> {
  const { issueKey, state } = ctx;
  const agents: WorkflowAgents = options?.agents ?? { techLead };
  const input: AgentInput = { issueKey, context: {} };
  const story = state.getStory(issueKey);
  const resumeFromMerge = options?.resumeFromMerge === true;

  log.info('workflow.review.start', { issueKey, resumeFromMerge });

  try {
    if (resumeFromMerge && story?.currentStep === 'stakeholder-review-pending') {
      await runReviewWorkflowResume(ctx, agents);
      return;
    }
    await runReviewWorkflowInner(ctx, input, agents);
  } catch (err) {
    log.error('workflow.review.unhandled-error', { issueKey, err: String(err) });
    await escalateToHumanReview(
      ctx.jira,
      issueKey,
      'Unexpected workflow error',
      ctx.state,
    );
  }
}

/** @deprecated Use `runReviewWorkflow`. Kept for callers that import the scaffold name. */
export const runReview = runReviewWorkflow;

export async function escalateToHumanReview(
  jira: JiraClient,
  issueKey: string,
  reason: string,
  state?: StateStore,
): Promise<void> {
  log.warn('workflow.escalate', { issueKey, reason });
  const body = `*Escalated to human review.*\n\n` + `Reason: ${reason}\n`;

  await jira.commentOnIssue(issueKey, body);
  await jira.transitionIssue(issueKey, 'Needs human review');

  if (state) {
    state.upsertStory(issueKey, 'needs-human-review');
  }
}
