import type { JiraClient } from './integrations/jira.js';
import type { GitlabClient } from './integrations/gitlab.js';
import { log } from './observability.js';
import { runQaWorkflow, watchRemediationTimeouts, type WorkflowCtxBase } from './workflow.js';
import type { Step, StateStore } from './state.js';
import { has, runQaWorkflowWithLock } from './in-flight.js';
import { recordTick } from './poller-state.js';

const TERMINAL_STEPS = new Set<Step>(['in-review', 'needs-human-review']);

/**
 * Dependencies for the poller — all values are injected at construction time
 * rather than read from the environment.
 */
export interface PollerDeps {
  identity: {
    jira: {
      projectKey: string;
      assigneeAccountId: string;
    };
  };
  behaviour: {
    pollIntervalMs: number;
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

function workflowCtxBase(
  deps: PollerDeps,
  state: StateStore,
): WorkflowCtxBase & { state: StateStore } {
  return {
    state,
    behaviour: deps.behaviour,
    jira: deps.jira,
    gitlab: deps.gitlab,
    qaWorkspaceDir: deps.qaWorkspaceDir,
  };
}

function dispatchQaWorkflow(issueKey: string, deps: PollerDeps, state: StateStore): void {
  const ctx = { issueKey, ...workflowCtxBase(deps, state) };
  runQaWorkflowWithLock(
    issueKey,
    () => runQaWorkflow(ctx),
    (err) => {
      log.error('poller.run-qa-workflow-error', { issueKey, err: String(err) });
    },
  );
}

/**
 * Execute one poll tick: query Jira for eligible In QA stories and fire
 * runQaWorkflow() for each result.
 *
 * Before dispatching, deduplication checks are applied:
 * - Stories at remediation-pending that reappear in In QA are resumed.
 * - Non-terminal in-progress stories are skipped.
 * - Terminal stories are silently ignored.
 * - In-flight locks prevent duplicate dispatch in this process.
 */
export async function pollTick(deps: PollerDeps, state: StateStore): Promise<void> {
  const { projectKey, assigneeAccountId } = deps.identity.jira;

  if (!projectKey || !assigneeAccountId) {
    const missing = [
      !projectKey && 'identity.jira.projectKey',
      !assigneeAccountId && 'identity.jira.assigneeAccountId',
    ].filter(Boolean);
    log.warn('poller.misconfigured', { missing });
    return;
  }

  const jql = `project = "${projectKey}" AND status = "In QA" AND assignee = "${assigneeAccountId}"`;

  let issues: Array<{ issueKey: string }>;
  try {
    issues = await deps.jira.searchIssues(jql);
  } catch (err) {
    log.warn('poller.search-error', { err: String(err) });
    recordTick('error');
    return;
  }

  for (const { issueKey } of issues) {
    const existing = state.getStory(issueKey);

    if (existing?.currentStep === 'remediation-pending') {
      if (has(issueKey)) {
        log.debug('poller.skip-in-flight', { issueKey });
        continue;
      }
      log.info('poller.remediation-resume', { issueKey });
      dispatchQaWorkflow(issueKey, deps, state);
      continue;
    }

    if (existing) {
      if (!TERMINAL_STEPS.has(existing.currentStep)) {
        log.debug('poller.skip-in-progress', { issueKey, step: existing.currentStep });
      }
      continue;
    }

    if (has(issueKey)) {
      log.debug('poller.skip-in-flight', { issueKey });
      continue;
    }

    dispatchQaWorkflow(issueKey, deps, state);
  }

  try {
    await watchRemediationTimeouts(workflowCtxBase(deps, state));
  } catch (err) {
    log.warn('poller.remediation-timeout-error', { err: String(err) });
  }

  recordTick('ok');
}

/**
 * Start the recurring poll interval and return the handle so callers can
 * clear it on shutdown.
 */
export function startPoller(deps: PollerDeps, state: StateStore): ReturnType<typeof setInterval> {
  log.info('poller.start', { intervalMs: deps.behaviour.pollIntervalMs });
  return setInterval(() => {
    void pollTick(deps, state).catch((err: unknown) => {
      recordTick('error');
      log.error('poller.unhandled-error', { err: String(err) });
    });
  }, deps.behaviour.pollIntervalMs);
}
