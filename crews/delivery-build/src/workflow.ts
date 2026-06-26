import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import {
  boundedIterGuard,
  IterationCapReached,
  type Agent,
  type AgentInput,
  type AgentResult,
} from '@daddia/crew';
import { engineer } from './agents/engineer/agent.js';
import { seniorEngineer } from './agents/senior-engineer/agent.js';
import type { GitlabClient, PipelineStatus } from './integrations/gitlab.js';
import type { JiraClient, JiraIssue } from './integrations/jira.js';
import { seedEngineerMemory } from './memory.js';
import { log, tracer } from './observability.js';
import { resolveModelForTask, type ModelRouting } from './model-routing.js';
import type { StateStore, Step } from './state.js';
import { publishRunStep, runStreamHub } from './run-stream-hub.js';

export interface WorkflowContext {
  issueKey: string;
  state: StateStore;
  behaviour: {
    refactorLoopCap: number;
    ciRetryCap: number;
    ciPollIntervalMs: number;
    ciWaitTimeoutMs: number;
    engineerMaxTurns: number;
    engineerCompactionThreshold: number;
    engineerCostCapUsd: number;
    modelRouting: ModelRouting;
  };
  jira: JiraClient;
  gitlab: GitlabClient;
  projectDir: string;
}

/**
 * The parts of WorkflowContext that are shared across all stories — everything
 * except issueKey and state. Handlers and recovery use this to build a full
 * WorkflowContext at call time.
 */
export type WorkflowCtxBase = Omit<WorkflowContext, 'issueKey' | 'state'>;

/** Injectable personas for CrewBench workflow fixtures. */
export interface WorkflowAgents {
  engineer: Agent;
  seniorEngineer: Agent;
}

export interface RunStoryOptions {
  agents?: WorkflowAgents;
  /** Stop after this step completes (used by the offline fixture story driver). */
  stopAfter?: Step;
  /** QA remediation re-entry — fix defects and re-hand off to QA. */
  remediation?: boolean;
}

const PIPELINE_SETTLING: ReadonlySet<PipelineStatus> = new Set(['created', 'pending', 'running']);

function isPipelineSettling(status: string): boolean {
  return PIPELINE_SETTLING.has(status as PipelineStatus);
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

type PipelineWaitResult = { status: string; timedOut: false } | { status: string; timedOut: true };

async function waitForPipelineSettled(
  gitlab: GitlabClient,
  mrUrl: string,
  behaviour: WorkflowContext['behaviour'],
): Promise<PipelineWaitResult> {
  const deadline = Date.now() + behaviour.ciWaitTimeoutMs;

  let status: string;
  do {
    if (behaviour.ciPollIntervalMs > 0) {
      await new Promise<void>((res) => setTimeout(res, behaviour.ciPollIntervalMs));
    }
    status = await gitlab.getPipelineStatus(mrUrl);
    if (!isPipelineSettling(status)) {
      return { status, timedOut: false };
    }
  } while (Date.now() < deadline);

  return { status, timedOut: true };
}

/**
 * Aggregate the step history into a cost summary and emit a single
 * `workflow.complete` log line. Called at every terminal exit point so
 * operators have a consistent record regardless of path taken.
 *
 * Wrapped in a try-catch so a DB error on `getStepHistory` never silences
 * the upstream Jira/GitLab outcome log.
 */
function emitWorkflowComplete(
  issueKey: string,
  state: StateStore,
  terminalStep: Step,
  success: boolean,
  mrUrl?: string,
): void {
  try {
    const history = state.getStepHistory(issueKey);
    const totalCostUsd = history.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    const agentSteps = history
      .filter((r) => r.sessionId !== null)
      .map((r) => ({ step: r.step, sessionId: r.sessionId!, costUsd: r.costUsd ?? 0 }));
    const firstStartedAt = history[0]?.startedAt ?? Date.now();
    const durationMs = Date.now() - firstStartedAt;

    log.info('workflow.complete', {
      issueKey,
      terminalStep,
      success,
      totalCostUsd,
      stepCount: history.length,
      agentSteps,
      durationMs,
      ...(mrUrl !== undefined ? { mrUrl } : {}),
    });
    runStreamHub.closeIssue(issueKey);
  } catch (err) {
    log.warn('workflow.complete.failed', { issueKey, err: String(err) });
  }
}

/**
 * Run the delivery build sequence for one story.
 *
 * Sequence:
 *   → engineer seeds context: reads Jira ticket + parent/epic (if present),
 *       design.md, and related artefacts
 *   → engineer assesses clarity; posts clarifying questions to Jira if required
 *       → ambiguous → status "Clarification Needed", park until human responds
 *   → status update: `to do` → `in progress`
 *   → engineer implements story on branch
 *   → senior-engineer peer review + address-feedback loop (cap: REFACTOR_LOOP_CAP)
 *   → engineer raises merge request
 *   → CI monitoring loop (cap: CI_RETRY_CAP)
 *   → status update: `in progress` → `in qa`
 */
export async function runStory(ctx: WorkflowContext, options?: RunStoryOptions): Promise<void> {
  const { issueKey } = ctx;
  const input: AgentInput = { issueKey, context: {} };
  const agents: WorkflowAgents = options?.agents ?? { engineer, seniorEngineer };

  log.info('workflow.start', { issueKey, remediation: options?.remediation ?? false });

  try {
    if (options?.remediation) {
      await runQaRemediationInner(ctx, input, agents);
      return;
    }
    await runStoryInner(ctx, input, agents, options?.stopAfter);
  } catch (err) {
    log.error('workflow.unhandled-error', { issueKey, err: String(err) });
    await escalateToHumanReview(ctx.jira, issueKey, 'Unexpected workflow error', [], ctx.state);
  }
}

function personaContext(
  ctx: WorkflowContext,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const task = extra['task'];
  return {
    maxTurns: ctx.behaviour.engineerMaxTurns,
    compactionThreshold: ctx.behaviour.engineerCompactionThreshold,
    ...extra,
    model:
      typeof task === 'string'
        ? resolveModelForTask(ctx.behaviour.modelRouting, task)
        : ctx.behaviour.modelRouting.implementation,
  };
}

function engineerContext(
  ctx: WorkflowContext,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return personaContext(ctx, {
    projectDir: ctx.projectDir,
    engineerCostCapUsd: ctx.behaviour.engineerCostCapUsd,
    ...extra,
  });
}

function isBoundedOperationFailure(result: AgentResult): boolean {
  return typeof result.artefacts['boundedReason'] === 'string';
}

async function runStoryInner(
  ctx: WorkflowContext,
  input: AgentInput,
  agents: WorkflowAgents,
  stopAfter?: Step,
): Promise<void> {
  const { issueKey, state, jira, gitlab, behaviour, projectDir } = ctx;
  const { engineer: eng, seniorEngineer: sr } = agents;

  await seedEngineerMemory(projectDir);

  // ── Step 1: Context seed ───────────────────────────────────────────────────
  let ticket: JiraIssue | null = null;
  let parentTicket: JiraIssue | null = null;

  await withWorkflowStepSpan('context-seed', issueKey, async () => {
    state.upsertStory(issueKey, 'context-seed');
    publishRunStep(issueKey, 'context-seed');
    state.startStep(issueKey, 'context-seed');

    try {
      ticket = await jira.getIssue(issueKey);
    } catch (err) {
      log.warn('workflow.context-seed.failed', { issueKey, err: String(err) });
    }

    if (ticket?.parentKey) {
      try {
        parentTicket = await jira.getIssue(ticket.parentKey);
      } catch (err) {
        log.warn('workflow.context-seed.parent-failed', {
          issueKey,
          parentKey: ticket.parentKey,
          err: String(err),
        });
      }
    }

    state.finishStep(issueKey, 'context-seed', { verdict: ticket ? 'ok' : 'failed' });
  });

  // ── Step 2: Assess clarification ──────────────────────────────────────────
  // Run before transitioning to In Progress so that an ambiguous ticket never
  // touches the board until the engineer is ready to commit to it.
  state.upsertStory(issueKey, 'assess-clarification');
  publishRunStep(issueKey, 'assess-clarification');

  const assessResult = await eng.run({
    ...input,
    context: engineerContext(ctx, {
      task: 'assess-clarification',
      ticket,
      parentTicket,
    }),
  });

  const assessSessionId = assessResult.artefacts['sessionId'] as string | undefined;
  state.startStep(issueKey, 'assess-clarification', assessSessionId);
  state.finishStep(issueKey, 'assess-clarification', {
    costUsd: assessResult.costUsd,
    verdict: assessResult.success ? 'ok' : 'failed',
  });

  if (!assessResult.success) {
    await escalateToHumanReview(
      jira,
      issueKey,
      'Engineer failed to assess ticket clarity',
      [],
      state,
    );
    return;
  }

  if (assessResult.artefacts['questionsRequired'] === true) {
    const questions =
      typeof assessResult.artefacts['questions'] === 'string'
        ? assessResult.artefacts['questions']
        : 'The engineer requires clarification before proceeding.';

    await jira.commentOnIssue(issueKey, questions);
    await jira.transitionIssue(issueKey, 'Clarification Needed');

    state.upsertStory(issueKey, 'clarification-pending');
    publishRunStep(issueKey, 'clarification-pending');
    state.startStep(issueKey, 'clarification-pending');
    state.finishStep(issueKey, 'clarification-pending', { verdict: 'pending' });

    log.info('workflow.blocked.clarification', { issueKey });
    emitWorkflowComplete(issueKey, state, 'clarification-pending', false);
    return;
  }

  // ── Step 3: Transition to In Progress ─────────────────────────────────────
  await jira.transitionIssue(issueKey, 'In Progress');

  // ── Step 4: Implement ─────────────────────────────────────────────────────
  state.upsertStory(issueKey, 'implement');
  publishRunStep(issueKey, 'implement');

  const implResult = await eng.run({
    ...input,
    context: engineerContext(ctx, {
      task: 'implement-story',
      ticket,
      parentTicket,
    }),
  });

  const branchNameRaw = implResult.artefacts['branchName'];
  const branchName: string | undefined =
    typeof branchNameRaw === 'string' && branchNameRaw ? branchNameRaw : undefined;

  let engineerSessionId = implResult.artefacts['sessionId'] as string | undefined;
  state.startStep(issueKey, 'implement', engineerSessionId);
  state.finishStep(issueKey, 'implement', {
    costUsd: implResult.costUsd,
    verdict: implResult.success && branchName !== undefined ? 'ok' : 'failed',
  });

  if (!implResult.success) {
    const boundedReason = implResult.artefacts['boundedReason'];
    const reason =
      typeof boundedReason === 'string' ? implResult.summary : 'Engineer failed to implement story';
    await escalateToHumanReview(jira, issueKey, reason, [], state);
    return;
  }

  if (!branchName) {
    await escalateToHumanReview(
      jira,
      issueKey,
      'Engineer did not produce a branch name',
      [],
      state,
    );
    return;
  }

  if (stopAfter === 'implement') {
    log.info('workflow.stopped', { issueKey, stopAfter: 'implement' });
    emitWorkflowComplete(issueKey, state, 'implement', true);
    return;
  }

  // ── Step 5: Peer review + address-feedback loop (MR not yet opened) ───────
  let reviewPassed = false;
  let unresolvedItems: string[] = [];
  const feedbackGuard = boundedIterGuard(behaviour.refactorLoopCap);

  for (let iteration = 0; iteration < behaviour.refactorLoopCap + 1; iteration++) {
    state.upsertStory(issueKey, 'peer-code-review');
    publishRunStep(issueKey, 'peer-code-review');
    state.startStep(issueKey, 'peer-code-review');

    const reviewResult = await sr.run({
      ...input,
      context: personaContext(ctx, { task: 'peer-code-review', branchName }),
    });

    state.finishStep(issueKey, 'peer-code-review', {
      costUsd: reviewResult.costUsd,
      verdict: reviewResult.success ? 'approved' : 'changes-requested',
    });

    if (reviewResult.success) {
      reviewPassed = true;
      break;
    }

    if (isBoundedOperationFailure(reviewResult)) {
      await escalateToHumanReview(jira, issueKey, reviewResult.summary, [], state);
      return;
    }

    unresolvedItems = (reviewResult.artefacts['comments'] as string[]) ?? [];

    try {
      feedbackGuard(iteration);
    } catch (err) {
      if (err instanceof IterationCapReached) {
        break;
      }
      throw err;
    }

    state.upsertStory(issueKey, 'address-feedback');
    publishRunStep(issueKey, 'address-feedback');

    const feedbackResult = await eng.run({
      ...input,
      context: engineerContext(ctx, {
        task: 'address-feedback',
        branchName,
        ticket,
        parentTicket,
        comments: unresolvedItems,
        previousSessionId: engineerSessionId,
      }),
    });

    engineerSessionId = feedbackResult.artefacts['sessionId'] as string | undefined;
    state.startStep(issueKey, 'address-feedback', engineerSessionId);
    state.finishStep(issueKey, 'address-feedback', {
      costUsd: feedbackResult.costUsd,
      verdict: feedbackResult.success ? 'addressed' : 'partial',
    });
  }

  if (!reviewPassed) {
    await escalateToHumanReview(
      jira,
      issueKey,
      'Refactor loop cap reached',
      unresolvedItems,
      state,
    );
    return;
  }

  // ── Step 6: Open MR ───────────────────────────────────────────────────────
  state.upsertStory(issueKey, 'open-mr');
  publishRunStep(issueKey, 'open-mr');
  state.startStep(issueKey, 'open-mr');

  const mrUrl = await gitlab.createMr({
    issueKey,
    branchName,
    title: `[${issueKey}] ${(implResult.artefacts['title'] as string) ?? 'Automated delivery'}`,
  });

  state.finishStep(issueKey, 'open-mr', { verdict: mrUrl });

  await monitorCiAndHandoffToQa(ctx, input, eng, mrUrl, branchName, behaviour);
}

const QA_DEFECT_COMMENT_PREFIX = '*QA defects found';
// Must stay aligned with the defect comment header written by delivery-qa
// when handing off to remediation (same string prefix, different crews).

function extractQaDefectComments(
  comments: Awaited<ReturnType<JiraClient['getComments']>>,
): string[] {
  return comments.filter((c) => c.body.includes(QA_DEFECT_COMMENT_PREFIX)).map((c) => c.body);
}

/**
 * QA remediation re-entry: fix documented defects and re-hand off to QA.
 * Triggered when a ticket returns from delivery-qa with label `qa-remediation`.
 */
async function runQaRemediationInner(
  ctx: WorkflowContext,
  input: AgentInput,
  agents: WorkflowAgents,
): Promise<void> {
  const { issueKey, state, jira, gitlab, behaviour } = ctx;
  const { engineer: eng } = agents;

  await seedEngineerMemory(ctx.projectDir);

  state.upsertStory(issueKey, 'qa-remediation');
  publishRunStep(issueKey, 'qa-remediation');
  state.startStep(issueKey, 'qa-remediation');

  let mrUrl: string | null = null;
  try {
    mrUrl = await gitlab.findOpenMrForIssue(issueKey);
  } catch (err) {
    log.warn('workflow.qa-remediation.mr-failed', { issueKey, err: String(err) });
  }

  if (!mrUrl) {
    state.finishStep(issueKey, 'qa-remediation', { verdict: 'failed' });
    await escalateToHumanReview(
      jira,
      issueKey,
      'No open merge request found for remediation',
      [],
      state,
    );
    return;
  }

  let branchName: string;
  try {
    branchName = await gitlab.getMrSourceBranch(mrUrl);
  } catch (err) {
    log.warn('workflow.qa-remediation.branch-failed', { issueKey, mrUrl, err: String(err) });
    state.finishStep(issueKey, 'qa-remediation', { verdict: 'failed' });
    await escalateToHumanReview(
      jira,
      issueKey,
      'Failed to resolve MR source branch',
      [],
      state,
      mrUrl,
    );
    return;
  }

  let defectComments: string[] = [];
  try {
    const comments = await jira.getComments(issueKey);
    defectComments = extractQaDefectComments(comments);
  } catch (err) {
    log.warn('workflow.qa-remediation.comments-failed', { issueKey, err: String(err) });
  }

  if (defectComments.length === 0) {
    state.finishStep(issueKey, 'qa-remediation', { verdict: 'failed' });
    await escalateToHumanReview(
      jira,
      issueKey,
      'No QA defect comments found on issue',
      [],
      state,
      mrUrl,
    );
    return;
  }

  state.finishStep(issueKey, 'qa-remediation', { verdict: 'ok' });

  state.upsertStory(issueKey, 'fix-qa-defects');
  publishRunStep(issueKey, 'fix-qa-defects');

  const fixResult = await eng.run({
    ...input,
    context: engineerContext(ctx, {
      task: 'fix-qa-defects',
      mrUrl,
      branchName,
      defectComments,
    }),
  });

  const fixSessionId = fixResult.artefacts['sessionId'] as string | undefined;
  state.startStep(issueKey, 'fix-qa-defects', fixSessionId);
  state.finishStep(issueKey, 'fix-qa-defects', {
    costUsd: fixResult.costUsd,
    verdict: fixResult.success ? 'ok' : 'failed',
  });

  if (!fixResult.success) {
    await escalateToHumanReview(
      jira,
      issueKey,
      fixResult.summary || 'Engineer failed to fix QA defects',
      defectComments,
      state,
      mrUrl,
    );
    return;
  }

  await monitorCiAndHandoffToQa(ctx, input, eng, mrUrl, branchName, behaviour);
}

async function monitorCiAndHandoffToQa(
  ctx: WorkflowContext,
  input: AgentInput,
  eng: Agent,
  mrUrl: string,
  branchName: string,
  behaviour: WorkflowContext['behaviour'],
): Promise<void> {
  const { issueKey, state, jira, gitlab } = ctx;

  let ciPassed = false;
  const ciGuard = boundedIterGuard(behaviour.ciRetryCap);

  for (let attempt = 0; ; attempt++) {
    try {
      ciGuard(attempt);
    } catch (err) {
      if (err instanceof IterationCapReached) {
        break;
      }
      throw err;
    }

    const waitResult = await waitForPipelineSettled(gitlab, mrUrl, behaviour);

    if (waitResult.timedOut) {
      await escalateToHumanReview(
        jira,
        issueKey,
        'CI pipeline wait timeout exceeded',
        [],
        state,
        mrUrl,
      );
      return;
    }

    const { status } = waitResult;

    if (status === 'success') {
      ciPassed = true;
      break;
    }

    state.upsertStory(issueKey, 'ci-check');
    publishRunStep(issueKey, 'ci-check');
    const ciFixResult = await eng.run({
      ...input,
      context: engineerContext(ctx, {
        task: 'fix-ci',
        mrUrl,
        branchName,
      }),
    });

    if (!ciFixResult.success) {
      break;
    }
  }

  if (!ciPassed) {
    await escalateToHumanReview(jira, issueKey, 'CI fix cap reached', [], state, mrUrl);
    return;
  }

  await handoffToQa(ctx, mrUrl, state, jira);
}

async function handoffToQa(
  ctx: WorkflowContext,
  mrUrl: string,
  state: StateStore,
  jira: JiraClient,
): Promise<void> {
  const { issueKey } = ctx;

  state.upsertStory(issueKey, 'in-qa');
  publishRunStep(issueKey, 'in-qa');
  state.startStep(issueKey, 'in-qa');
  await jira.transitionIssue(issueKey, 'In QA');
  state.finishStep(issueKey, 'in-qa', { verdict: 'ok' });

  log.info('workflow.handoff-to-qa', { issueKey, mrUrl });
  emitWorkflowComplete(issueKey, state, 'in-qa', true, mrUrl);
}

async function escalateToHumanReview(
  jira: JiraClient,
  issueKey: string,
  reason: string,
  unresolvedItems: string[],
  state?: StateStore,
  mrUrl?: string,
): Promise<void> {
  log.warn('workflow.escalate', { issueKey, reason });
  const body =
    `*Escalated to human review.*\n\n` +
    `Reason: ${reason}\n\n` +
    (unresolvedItems.length > 0
      ? `Unresolved items:\n${unresolvedItems.map((i) => `- ${i}`).join('\n')}`
      : '');

  await jira.commentOnIssue(issueKey, body);
  await jira.transitionIssue(issueKey, 'Needs human review');

  if (state) {
    emitWorkflowComplete(issueKey, state, 'needs-human-review', false, mrUrl);
  }
}

/**
 * Scan for agent steps that started a session but never finished (process
 * crash mid-run). For each interrupted row, attempt to reconnect the SDK
 * session: if the session is still accessible, log info and restart the
 * story workflow; if the reconnect throws, log a warning and escalate.
 *
 * Called once on startup, before the HTTP server and poller are initialised,
 * so no new stories begin processing while recovery is in progress.
 */
export async function recoverInterruptedSteps(
  state: StateStore,
  ctxBase: WorkflowCtxBase,
): Promise<void> {
  const interrupted = state.getInterruptedSteps();

  for (const row of interrupted) {
    const { issueKey, step, sessionId } = row;

    try {
      const sessionInfo = await getSessionInfo(sessionId!, { dir: ctxBase.projectDir });
      if (!sessionInfo) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      log.info('recovery.session-resumed', { issueKey, step, sessionId });
      await runStory({ issueKey, state, ...ctxBase });
    } catch (err) {
      log.warn('recovery.session-failed', { issueKey, step, sessionId, err: String(err) });
      try {
        await escalateToHumanReview(
          ctxBase.jira,
          issueKey,
          'Crash recovery failed: ' + String(err),
          [],
          state,
        );
      } catch (escalateErr) {
        log.error('recovery.escalation-failed', { issueKey, err: String(escalateErr) });
      }
    }
  }
}

/**
 * Address reviewer feedback on an open MR. Triggered by the GitLab webhook
 * when a human posts a non-system note on a merge request.
 */
export async function addressFeedback(
  ctx: WorkflowContext,
  comment: string,
  mrUrl: string,
): Promise<void> {
  const { issueKey, state, jira, gitlab } = ctx;
  const input: AgentInput = { issueKey, context: {} };

  log.info('workflow.address-feedback.start', { issueKey, mrUrl });

  let branchName: string | undefined;
  try {
    branchName = await gitlab.getMrSourceBranch(mrUrl);
  } catch (err) {
    log.warn('workflow.address-feedback.branch-failed', { issueKey, mrUrl, err: String(err) });
  }

  try {
    state.upsertStory(issueKey, 'address-feedback');
    publishRunStep(issueKey, 'address-feedback');

    const result = await engineer.run({
      ...input,
      context: engineerContext(ctx, {
        task: 'address-feedback',
        mrUrl,
        branchName,
        comments: [comment],
      }),
    });

    const sessionId = result.artefacts['sessionId'] as string | undefined;
    state.startStep(issueKey, 'address-feedback', sessionId);
    state.finishStep(issueKey, 'address-feedback', {
      costUsd: result.costUsd,
      verdict: result.success ? 'addressed' : 'partial',
    });

    if (!result.success) {
      await escalateToHumanReview(
        jira,
        issueKey,
        'Engineer failed to address feedback',
        [comment],
        state,
        mrUrl,
      );
    }
  } catch (err) {
    log.error('workflow.address-feedback.error', { issueKey, err: String(err) });
    await escalateToHumanReview(
      jira,
      issueKey,
      'Unexpected error during address-feedback',
      [],
      state,
      mrUrl,
    );
  }
}
