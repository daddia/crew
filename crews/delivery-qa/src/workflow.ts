import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { Agent, AgentInput, AgentResult } from '@daddia/crew';
import { boundedIterGuard, IterationCapReached } from '@daddia/crew';
import { qaEngineer } from './agents/qa-engineer/agent.js';
import type { GitlabClient } from './integrations/gitlab.js';
import type { JiraClient, JiraIssue } from './integrations/jira.js';
import { log, tracer } from './observability.js';
import {
  defaultQaWorkspace,
  QaWorkspaceError,
  type QaWorkspacePort,
} from './qa-workspace.js';
import type { StateStore, Step } from './state.js';

/** Default model for qa-engineer runs until dedicated routing lands. */
const QA_ENGINEER_MODEL = 'claude-sonnet-4-6';

export interface QaDefect {
  id: string;
  severity: 'blocker' | 'major' | 'minor';
  summary: string;
  stepsToReproduce: string;
  expected: string;
  observed: string;
}

export interface WorkflowContext {
  issueKey: string;
  state: StateStore;
  behaviour: {
    qaDefectLoopCap: number;
    remediationTimeoutHours: number;
    externalIntegrationMode: 'mock' | 'live' | 'skip';
    automatedTestCommand: string;
    e2eTestCommand?: string;
    qaDeployScript?: string;
    qaEngineerMaxTurns: number;
    qaEngineerCostCapUsd: number;
  };
  jira: JiraClient;
  gitlab: GitlabClient;
  qaWorkspaceDir: string;
}

export type WorkflowCtxBase = Omit<WorkflowContext, 'issueKey' | 'state'>;

export interface WorkflowAgents {
  qaEngineer: Agent;
}

export interface RunQaWorkflowOptions {
  agents?: WorkflowAgents;
  workspace?: QaWorkspacePort;
}

interface QaSeedContext {
  ticket: JiraIssue | null;
  mrUrl: string;
  branchName: string;
  pipelineStatus: string;
  acceptanceCriteria: string;
}

interface ValidationOutcome {
  ok: boolean;
  defects: QaDefect[];
  infraReason?: string;
}

async function withWorkflowStepSpan<T>(
  stepName: Step,
  issueKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan('workflow.step', async (span: { setAttribute(key: string, value: string): void; end(): void }) => {
    span.setAttribute('workflow.step', stepName);
    span.setAttribute('issueKey', issueKey);
    try {
      return await fn();
    } finally {
      span.end();
    }
  });
}

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

    log.info('workflow.qa.complete', {
      issueKey,
      terminalStep,
      success,
      totalCostUsd,
      stepCount: history.length,
      agentSteps,
      durationMs,
      ...(mrUrl !== undefined ? { mrUrl } : {}),
    });
  } catch (err) {
    log.warn('workflow.qa.complete.failed', { issueKey, err: String(err) });
  }
}

function qaEngineerContext(
  ctx: WorkflowContext,
  seed: QaSeedContext,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    model: QA_ENGINEER_MODEL,
    maxTurns: ctx.behaviour.qaEngineerMaxTurns,
    qaEngineerCostCapUsd: ctx.behaviour.qaEngineerCostCapUsd,
    qaWorkspaceDir: ctx.qaWorkspaceDir,
    mrUrl: seed.mrUrl,
    branchName: seed.branchName,
    pipelineStatus: seed.pipelineStatus,
    acceptanceCriteria: seed.acceptanceCriteria,
    ...extra,
  };
}

function isQaDefect(value: unknown): value is QaDefect {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d['id'] === 'string' &&
    (d['severity'] === 'blocker' || d['severity'] === 'major' || d['severity'] === 'minor') &&
    typeof d['summary'] === 'string' &&
    typeof d['stepsToReproduce'] === 'string' &&
    typeof d['expected'] === 'string' &&
    typeof d['observed'] === 'string'
  );
}

function extractDefects(result: AgentResult): QaDefect[] {
  const raw = result.artefacts['defects'];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isQaDefect);
}

function formatDefectComment(defects: QaDefect[]): string {
  let body = '*QA defects found — remediation required*\n\n';
  for (const defect of defects) {
    body +=
      `*${defect.id}* (${defect.severity}): ${defect.summary}\n` +
      `Steps: ${defect.stepsToReproduce}\n` +
      `Expected: ${defect.expected}\n` +
      `Observed: ${defect.observed}\n\n`;
  }
  return body.trimEnd();
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
    verdict: result.success ? 'ok' : 'failed',
  });

  return result;
}

/**
 * Run the QA validation sequence for one story through exploratory pass.
 *
 * Sequence:
 *   context-seed → deploy-qa → automated-suite → exploratory-pass
 *   → external-integration (mock stub when mode is mock)
 *   → defect loop on product failures (document-defects → remediation-handoff → remediation-pending)
 */
export async function runQaWorkflow(
  ctx: WorkflowContext,
  options?: RunQaWorkflowOptions,
): Promise<void> {
  const { issueKey } = ctx;
  const agents: WorkflowAgents = options?.agents ?? { qaEngineer };
  const workspace = options?.workspace ?? defaultQaWorkspace;
  const input: AgentInput = { issueKey, context: {} };

  log.info('workflow.qa.start', { issueKey });

  try {
    await runQaWorkflowInner(ctx, input, agents, workspace);
  } catch (err) {
    log.error('workflow.qa.unhandled-error', { issueKey, err: String(err) });
    await escalateToHumanReview(ctx.jira, issueKey, 'Unexpected workflow error', ctx.state);
  }
}

async function seedQaContext(
  ctx: WorkflowContext,
): Promise<QaSeedContext | null> {
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
      await escalateToHumanReview(
        jira,
        issueKey,
        'No open merge request found for issue',
        state,
      );
      return null;
    }

    let branchName: string;
    try {
      branchName = await gitlab.getMrSourceBranch(mrUrl);
    } catch (err) {
      log.warn('workflow.context-seed.branch-failed', { issueKey, mrUrl, err: String(err) });
      state.finishStep(issueKey, 'context-seed', { verdict: 'failed' });
      await escalateToHumanReview(jira, issueKey, 'Failed to resolve MR source branch', state, mrUrl);
      return null;
    }

    let pipelineStatus: string;
    try {
      pipelineStatus = await gitlab.getPipelineStatus(mrUrl);
    } catch (err) {
      log.warn('workflow.context-seed.pipeline-failed', { issueKey, mrUrl, err: String(err) });
      state.finishStep(issueKey, 'context-seed', { verdict: 'failed' });
      await escalateToHumanReview(jira, issueKey, 'Failed to read pipeline status', state, mrUrl);
      return null;
    }

    if (pipelineStatus !== 'success') {
      state.finishStep(issueKey, 'context-seed', { verdict: 'failed' });
      await escalateToHumanReview(
        jira,
        issueKey,
        `CI pipeline not green at QA start (status: ${pipelineStatus})`,
        state,
        mrUrl,
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

async function runValidationSteps(
  ctx: WorkflowContext,
  qaSeed: QaSeedContext,
  input: AgentInput,
  agents: WorkflowAgents,
  workspace: QaWorkspacePort,
): Promise<ValidationOutcome> {
  const { issueKey, state, behaviour } = ctx;
  const collectedDefects: QaDefect[] = [];

  // ── Automated suite ────────────────────────────────────────────────────────
  state.upsertStory(issueKey, 'automated-suite');

  let testOutput = '';
  const automated = await workspace.runTestCommand(
    ctx.qaWorkspaceDir,
    behaviour.automatedTestCommand,
  );
  testOutput += automated.output;
  const automatedFailed = automated.exitCode !== 0;

  if (behaviour.e2eTestCommand) {
    const e2e = await workspace.runTestCommand(ctx.qaWorkspaceDir, behaviour.e2eTestCommand);
    testOutput += (testOutput.length > 0 ? '\n' : '') + e2e.output;
    if (e2e.exitCode !== 0) {
      state.startStep(issueKey, 'automated-suite');
      state.finishStep(issueKey, 'automated-suite', { verdict: 'failed' });
      const e2eResult = await runAgentStep(
        ctx,
        'automated-suite',
        {
          ...input,
          context: qaEngineerContext(ctx, qaSeed, {
            task: 'run-automated-suite',
            testOutput,
          }),
        },
        agents.qaEngineer,
      );
      const e2eDefects = extractDefects(e2eResult);
      if (e2eDefects.length > 0) {
        return { ok: false, defects: e2eDefects };
      }
      return {
        ok: false,
        defects: [],
        infraReason: e2eResult.summary || 'E2E test command failed',
      };
    }
  }

  if (automatedFailed) {
    state.startStep(issueKey, 'automated-suite');
    state.finishStep(issueKey, 'automated-suite', { verdict: 'failed' });
  }

  const suiteResult = await runAgentStep(
    ctx,
    'automated-suite',
    {
      ...input,
      context: qaEngineerContext(ctx, qaSeed, {
        task: 'run-automated-suite',
        testOutput,
      }),
    },
    agents.qaEngineer,
  );

  if (!suiteResult.success) {
    const suiteDefects = extractDefects(suiteResult);
    if (suiteDefects.length > 0) {
      collectedDefects.push(...suiteDefects);
    } else {
      return {
        ok: false,
        defects: [],
        infraReason: suiteResult.summary || 'Automated suite QA step failed',
      };
    }
  }

  // ── Exploratory pass ───────────────────────────────────────────────────────
  const exploreResult = await runAgentStep(
    ctx,
    'exploratory-pass',
    {
      ...input,
      context: qaEngineerContext(ctx, qaSeed, { task: 'exploratory-pass' }),
    },
    agents.qaEngineer,
  );

  if (!exploreResult.success) {
    const exploreDefects = extractDefects(exploreResult);
    if (exploreDefects.length > 0) {
      collectedDefects.push(...exploreDefects);
    } else {
      return {
        ok: false,
        defects: [],
        infraReason: exploreResult.summary || 'Exploratory pass failed',
      };
    }
  }

  // ── External integration (mock stub) ─────────────────────────────────────
  if (behaviour.externalIntegrationMode !== 'skip') {
    state.upsertStory(issueKey, 'external-integration');
    state.startStep(issueKey, 'external-integration');

    if (behaviour.externalIntegrationMode === 'mock') {
      log.info('workflow.external-integration.skipped', { issueKey, mode: 'mock' });
      state.finishStep(issueKey, 'external-integration', { verdict: 'ok' });
    } else {
      state.finishStep(issueKey, 'external-integration', { verdict: 'failed' });
      return {
        ok: false,
        defects: [],
        infraReason: 'External integration live mode is not yet implemented',
      };
    }
  }

  if (collectedDefects.length > 0) {
    return { ok: false, defects: collectedDefects };
  }

  return { ok: true, defects: [] };
}

async function handleProductDefects(
  ctx: WorkflowContext,
  qaSeed: QaSeedContext,
  defects: QaDefect[],
  input: AgentInput,
  agents: WorkflowAgents,
  testOutput?: string,
): Promise<void> {
  const { issueKey, state, jira, behaviour } = ctx;
  const defectGuard = boundedIterGuard(behaviour.qaDefectLoopCap);
  const priorRemediations = state.countStepOccurrences(issueKey, 'remediation-handoff');

  try {
    defectGuard(priorRemediations);
  } catch (err) {
    if (err instanceof IterationCapReached) {
      const body =
        `*Defect loop cap reached — escalating to human review.*\n\n` +
        formatDefectComment(defects);
      await jira.commentOnIssue(issueKey, body);
      await escalateToHumanReview(
        jira,
        issueKey,
        'Defect loop cap reached',
        state,
        qaSeed.mrUrl,
      );
      return;
    }
    throw err;
  }

  const docResult = await runAgentStep(
    ctx,
    'document-defects',
    {
      ...input,
      context: qaEngineerContext(ctx, qaSeed, {
        task: 'document-defects',
        priorDefects: defects.map((d) => d.id),
        ...(testOutput !== undefined ? { testOutput } : {}),
      }),
    },
    agents.qaEngineer,
  );

  const documentedDefects = extractDefects(docResult);
  const finalDefects = documentedDefects.length > 0 ? documentedDefects : defects;

  if (finalDefects.length === 0) {
    await escalateToHumanReview(
      jira,
      issueKey,
      'document-defects step produced no structured defects',
      state,
      qaSeed.mrUrl,
    );
    return;
  }

  state.upsertStory(issueKey, 'remediation-handoff');
  state.startStep(issueKey, 'remediation-handoff');

  await jira.commentOnIssue(issueKey, formatDefectComment(finalDefects));
  await jira.transitionIssue(issueKey, 'In Remediation');
  await jira.addLabel(issueKey, 'qa-remediation');

  state.finishStep(issueKey, 'remediation-handoff', { verdict: 'ok' });

  log.info('workflow.remediation-required', {
    issueKey,
    mrUrl: qaSeed.mrUrl,
    defectCount: finalDefects.length,
  });

  state.upsertStory(issueKey, 'remediation-pending');
  state.startStep(issueKey, 'remediation-pending');

  emitWorkflowComplete(issueKey, state, 'remediation-pending', false, qaSeed.mrUrl);
}

/**
 * Escalate stories stuck in remediation-pending past REMEDIATION_TIMEOUT_HOURS.
 * Intended for the poller tick (CREW-05-05); exported for unit tests.
 */
export async function watchRemediationTimeouts(ctx: WorkflowCtxBase & { state: StateStore }): Promise<void> {
  const { state, jira, behaviour } = ctx;
  const timeoutMs = behaviour.remediationTimeoutHours * 60 * 60 * 1000;
  const now = Date.now();

  const pendingStories = state.getStoriesAtStep('remediation-pending');
  for (const story of pendingStories) {
    if (now - story.startedAt >= timeoutMs) {
      log.warn('workflow.remediation-timeout', {
        issueKey: story.issueKey,
        elapsedHours: (now - story.startedAt) / (60 * 60 * 1000),
      });
      await escalateToHumanReview(
        jira,
        story.issueKey,
        `Remediation timeout exceeded (${behaviour.remediationTimeoutHours}h)`,
        state,
      );
    }
  }
}

async function runQaWorkflowInner(
  ctx: WorkflowContext,
  input: AgentInput,
  agents: WorkflowAgents,
  workspace: QaWorkspacePort,
): Promise<void> {
  const { issueKey, state, jira, behaviour, qaWorkspaceDir } = ctx;

  const qaSeed = await seedQaContext(ctx);
  if (!qaSeed) {
    return;
  }

  // ── Step 2: Deploy QA ──────────────────────────────────────────────────────
  state.upsertStory(issueKey, 'deploy-qa');

  try {
    await workspace.checkoutMrRef(qaSeed.branchName, qaWorkspaceDir);
    await workspace.runDeployScript(qaWorkspaceDir, behaviour.qaDeployScript);
  } catch (err) {
    const reason =
      err instanceof QaWorkspaceError
        ? `QA workspace deploy failed: ${err.message}`
        : `QA workspace deploy failed: ${String(err)}`;
    state.startStep(issueKey, 'deploy-qa');
    state.finishStep(issueKey, 'deploy-qa', { verdict: 'failed' });
    await escalateToHumanReview(jira, issueKey, reason, state, qaSeed.mrUrl);
    return;
  }

  const deployResult = await runAgentStep(
    ctx,
    'deploy-qa',
    {
      ...input,
      context: qaEngineerContext(ctx, qaSeed, { task: 'deploy-qa' }),
    },
    agents.qaEngineer,
  );

  if (!deployResult.success) {
    await escalateToHumanReview(
      jira,
      issueKey,
      deployResult.summary || 'QA deploy step failed',
      state,
      qaSeed.mrUrl,
    );
    return;
  }

  const validation = await runValidationSteps(ctx, qaSeed, input, agents, workspace);

  if (validation.infraReason) {
    await escalateToHumanReview(jira, issueKey, validation.infraReason, state, qaSeed.mrUrl);
    return;
  }

  if (!validation.ok && validation.defects.length > 0) {
    await handleProductDefects(ctx, qaSeed, validation.defects, input, agents);
    return;
  }

  emitWorkflowComplete(issueKey, state, 'exploratory-pass', true, qaSeed.mrUrl);
}

/**
 * Scan for agent steps that started a session but never finished (process
 * crash mid-run). For each interrupted row, attempt to reconnect the SDK
 * session: if the session is still accessible, log info and restart the QA
 * workflow; if the reconnect throws, log a warning and escalate.
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
      const sessionInfo = await getSessionInfo(sessionId!, { dir: ctxBase.qaWorkspaceDir });
      if (!sessionInfo) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      log.info('recovery.session-resumed', { issueKey, step, sessionId });
      await runQaWorkflow({ issueKey, state, ...ctxBase });
    } catch (err) {
      log.warn('recovery.session-failed', { issueKey, step, sessionId, err: String(err) });
      try {
        await escalateToHumanReview(
          ctxBase.jira,
          issueKey,
          'Crash recovery failed: ' + String(err),
          state,
        );
      } catch (escalateErr) {
        log.error('recovery.escalation-failed', { issueKey, err: String(escalateErr) });
      }
    }
  }
}

export async function escalateToHumanReview(
  jira: JiraClient,
  issueKey: string,
  reason: string,
  state?: StateStore,
  mrUrl?: string,
): Promise<void> {
  log.warn('workflow.escalate', { issueKey, reason });
  const body =
    `*Escalated to human review.*\n\n` +
    `Reason: ${reason}\n`;

  await jira.commentOnIssue(issueKey, body);
  await jira.transitionIssue(issueKey, 'Needs human review');

  if (state) {
    state.upsertStory(issueKey, 'needs-human-review');
    emitWorkflowComplete(issueKey, state, 'needs-human-review', false, mrUrl);
  }
}
