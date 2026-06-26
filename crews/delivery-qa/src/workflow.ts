import type { Agent, AgentInput, AgentResult } from '@daddia/crew';
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

  // ── Step 3: Automated suite ────────────────────────────────────────────────
  state.upsertStory(issueKey, 'automated-suite');

  let testOutput = '';
  const automated = await workspace.runTestCommand(qaWorkspaceDir, behaviour.automatedTestCommand);
  testOutput += automated.output;

  if (behaviour.e2eTestCommand) {
    const e2e = await workspace.runTestCommand(qaWorkspaceDir, behaviour.e2eTestCommand);
    testOutput += (testOutput.length > 0 ? '\n' : '') + e2e.output;
    if (e2e.exitCode !== 0) {
      state.startStep(issueKey, 'automated-suite');
      state.finishStep(issueKey, 'automated-suite', { verdict: 'failed' });
      await escalateToHumanReview(
        jira,
        issueKey,
        'E2E test command failed',
        state,
        qaSeed.mrUrl,
      );
      return;
    }
  }

  if (automated.exitCode !== 0) {
    state.startStep(issueKey, 'automated-suite');
    state.finishStep(issueKey, 'automated-suite', { verdict: 'failed' });
    await escalateToHumanReview(
      jira,
      issueKey,
      'Automated test command failed',
      state,
      qaSeed.mrUrl,
    );
    return;
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
    await escalateToHumanReview(
      jira,
      issueKey,
      suiteResult.summary || 'Automated suite QA step failed',
      state,
      qaSeed.mrUrl,
    );
    return;
  }

  // ── Step 4: Exploratory pass ───────────────────────────────────────────────
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
    await escalateToHumanReview(
      jira,
      issueKey,
      exploreResult.summary || 'Exploratory pass failed',
      state,
      qaSeed.mrUrl,
    );
    return;
  }

  // ── Step 5: External integration (mock stub) ───────────────────────────────
  if (behaviour.externalIntegrationMode !== 'skip') {
    state.upsertStory(issueKey, 'external-integration');
    state.startStep(issueKey, 'external-integration');

    if (behaviour.externalIntegrationMode === 'mock') {
      log.info('workflow.external-integration.skipped', { issueKey, mode: 'mock' });
      state.finishStep(issueKey, 'external-integration', { verdict: 'ok' });
    } else {
      // live mode deferred — escalate so operators know configuration is incomplete
      state.finishStep(issueKey, 'external-integration', { verdict: 'failed' });
      await escalateToHumanReview(
        jira,
        issueKey,
        'External integration live mode is not yet implemented',
        state,
        qaSeed.mrUrl,
      );
      return;
    }
  }

  emitWorkflowComplete(issueKey, state, 'exploratory-pass', true, qaSeed.mrUrl);
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
