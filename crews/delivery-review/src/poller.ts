import type { JiraClient } from './integrations/jira.js';
import { probePmApproval } from './integrations/jira.js';
import type { GitlabClient } from './integrations/gitlab.js';
import { log } from './observability.js';
import { escalateToHumanReview, runReviewWorkflow, type WorkflowCtxBase } from './workflow.js';
import type { Step, StateStore } from './state.js';
import { has, runReviewWorkflowWithLock } from './in-flight.js';
import { recordTick } from './poller-state.js';

const TERMINAL_STEPS = new Set<Step>(['done', 'needs-human-review']);

/**
 * Dependencies for the poller — all values are injected at construction time
 * rather than read from the environment.
 */
export interface PollerDeps {
  identity: {
    jira: {
      projectKey: string;
      assigneeAccountId: string;
      pmApproverAccountIds: string[];
    };
  };
  behaviour: {
    pollIntervalMs: number;
    pmReviewTimeoutHours: number;
    pmApprovalCommentPattern: string;
    techLeadMaxTurns: number;
    techLeadCostCapUsd: number;
    diffFileCap: number;
    diffSizeCapBytes: number;
  };
  jira: JiraClient;
  gitlab: GitlabClient;
}

async function pollStakeholderPendingStories(
  deps: PollerDeps,
  state: StateStore,
  ctxBase: WorkflowCtxBase,
): Promise<void> {
  const timeoutMs = deps.behaviour.pmReviewTimeoutHours * 60 * 60 * 1000;
  const pendingStories = state.getStoriesAtStep('stakeholder-review-pending');

  for (const story of pendingStories) {
    const { issueKey } = story;

    if (has(issueKey)) {
      log.debug('poller.skip-in-flight', { issueKey });
      continue;
    }

    let mrState: Awaited<ReturnType<typeof deps.gitlab.findMrForIssue>>;
    try {
      mrState = await deps.gitlab.findMrForIssue(issueKey);
    } catch (err) {
      log.warn('poller.stakeholder-mr-check-error', { issueKey, err: String(err) });
      continue;
    }

    if (mrState?.state === 'merged') {
      let jiraStatus: string;
      try {
        jiraStatus = await deps.jira.getIssueStatus(issueKey);
      } catch (err) {
        log.warn('poller.stakeholder-status-check-error', { issueKey, err: String(err) });
        continue;
      }

      if (jiraStatus === 'Done') {
        state.upsertStory(issueKey, 'done');
        log.info('poller.stakeholder-reconciled', { issueKey, mrUrl: mrState.mrUrl });
        continue;
      }

      try {
        await escalateToHumanReview(
          deps.jira,
          issueKey,
          'MR merged externally while awaiting PM approval — Jira still In Review',
          state,
        );
      } catch (err) {
        log.error('poller.stakeholder-external-merge-error', { issueKey, err: String(err) });
      }
      continue;
    }

    const history = state.getStepHistory(issueKey);
    const pendingStep = [...history].reverse().find((s) => s.step === 'stakeholder-review-pending');
    if (!pendingStep) {
      log.warn('poller.stakeholder-step-missing', { issueKey });
      continue;
    }
    const pendingStartedAt = pendingStep.startedAt;

    let comments: Awaited<ReturnType<typeof deps.jira.getComments>>;
    try {
      comments = await deps.jira.getComments(issueKey);
    } catch (err) {
      log.warn('poller.stakeholder-check-error', { issueKey, err: String(err) });
      continue;
    }

    const approval = probePmApproval(
      comments,
      deps.behaviour.pmApprovalCommentPattern,
      deps.identity.jira.pmApproverAccountIds,
      pendingStartedAt,
    );

    if (approval) {
      log.info('poller.stakeholder-resolved', { issueKey });
      runReviewWorkflowWithLock(
        issueKey,
        () => runReviewWorkflow({ ...ctxBase, issueKey, state }, { resumeFromMerge: true }),
        (err) => {
          log.error('poller.run-review-error', { issueKey, err: String(err) });
        },
      );
      continue;
    }

    if (Date.now() - pendingStartedAt > timeoutMs) {
      log.warn('poller.stakeholder-timeout', {
        issueKey,
        timeoutHours: deps.behaviour.pmReviewTimeoutHours,
      });
      try {
        await escalateToHumanReview(
          deps.jira,
          issueKey,
          `PM approval timeout — no sign-off received within ${deps.behaviour.pmReviewTimeoutHours} hours`,
          state,
        );
      } catch (err) {
        log.error('poller.stakeholder-timeout-error', { issueKey, err: String(err) });
      }
    }
  }
}

/**
 * Execute one poll tick: query Jira for eligible In Review stories and fire
 * runReviewWorkflow for each result, then probe stakeholder-review-pending
 * stories for PM approval or external merge reconciliation.
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

  const jql = `project = "${projectKey}" AND status = "In Review" AND assignee = "${assigneeAccountId}"`;

  let issues: Array<{ issueKey: string }>;
  try {
    issues = await deps.jira.searchIssues(jql);
  } catch (err) {
    log.warn('poller.search-error', { err: String(err) });
    recordTick('error');
    return;
  }

  const ctxBase: WorkflowCtxBase = {
    behaviour: {
      pmReviewTimeoutHours: deps.behaviour.pmReviewTimeoutHours,
      pmApprovalCommentPattern: deps.behaviour.pmApprovalCommentPattern,
      techLeadMaxTurns: deps.behaviour.techLeadMaxTurns,
      techLeadCostCapUsd: deps.behaviour.techLeadCostCapUsd,
      diffFileCap: deps.behaviour.diffFileCap,
      diffSizeCapBytes: deps.behaviour.diffSizeCapBytes,
    },
    jira: deps.jira,
    gitlab: deps.gitlab,
  };

  for (const { issueKey } of issues) {
    const existing = state.getStory(issueKey);
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

    runReviewWorkflowWithLock(
      issueKey,
      () => runReviewWorkflow({ issueKey, state, ...ctxBase }),
      (err) => {
        log.error('poller.run-review-error', { issueKey, err: String(err) });
      },
    );
  }

  await pollStakeholderPendingStories(deps, state, ctxBase);

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
