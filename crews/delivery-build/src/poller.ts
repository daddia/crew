import type { JiraClient } from "./integrations/jira.js";
import type { GitlabClient } from "./integrations/gitlab.js";
import { log } from "./observability.js";
import { runStory } from "./workflow.js";
import type { WorkflowCtxBase } from "./workflow.js";
import type { Step, StateStore } from "./state.js";
import { has, runStoryWithLock } from "./in-flight.js";
import { recordTick } from "./poller-state.js";

const TERMINAL_STEPS = new Set<Step>(["in-qa", "needs-human-review"]);

/**
 * Dependencies for the poller — all values are injected at construction time
 * rather than read from the environment.
 */
export interface PollerDeps {
  identity: {
    jira: {
      projectKey: string;
      assigneeAccountId: string;
      email: string;
      botAccountId?: string;
    };
  };
  behaviour: {
    pollIntervalMs: number;
    clarificationTimeoutHours: number;
    refactorLoopCap: number;
    ciRetryCap: number;
    ciPollIntervalMs: number;
    anthropicModel?: string;
  };
  jira: JiraClient;
  gitlab: GitlabClient;
  projectDir: string;
}

/**
 * Execute one poll tick: query Jira for eligible To Do stories and fire
 * runStory() for each result.
 *
 * Before dispatching, two deduplication checks are applied:
 * - If the story already has a state record, skip it (non-terminal steps
 *   emit a debug log; terminal steps are silently ignored because Jira
 *   sometimes returns tickets that have already been handed off).
 * - If the story is already running in this process, skip it.
 */
export async function pollTick(deps: PollerDeps, state: StateStore): Promise<void> {
  const { projectKey, assigneeAccountId } = deps.identity.jira;

  if (!projectKey || !assigneeAccountId) {
    const missing = [
      !projectKey && "identity.jira.projectKey",
      !assigneeAccountId && "identity.jira.assigneeAccountId",
    ].filter(Boolean);
    log.warn("poller.misconfigured", { missing });
    return;
  }

  const jql = `project = "${projectKey}" AND status = "To Do" AND assignee = "${assigneeAccountId}"`;

  let issues: Array<{ issueKey: string }>;
  try {
    issues = await deps.jira.searchIssues(jql);
  } catch (err) {
    log.warn("poller.search-error", { err: String(err) });
    recordTick("error");
    return;
  }

  const ctxBase: WorkflowCtxBase = {
    behaviour: {
      refactorLoopCap: deps.behaviour.refactorLoopCap,
      ciRetryCap: deps.behaviour.ciRetryCap,
      ciPollIntervalMs: deps.behaviour.ciPollIntervalMs,
      anthropicModel: deps.behaviour.anthropicModel,
    },
    jira: deps.jira,
    gitlab: deps.gitlab,
    projectDir: deps.projectDir,
  };

  for (const { issueKey } of issues) {
    const existing = state.getStory(issueKey);
    if (existing) {
      if (!TERMINAL_STEPS.has(existing.currentStep)) {
        log.debug("poller.skip-in-progress", { issueKey, step: existing.currentStep });
      }
      continue;
    }

    if (has(issueKey)) {
      log.debug("poller.skip-in-flight", { issueKey });
      continue;
    }

    runStoryWithLock(
      issueKey,
      () => runStory({ issueKey, state, ...ctxBase }),
      (err) => {
        log.error("poller.run-story-error", { issueKey, err: String(err) });
      },
    );
  }

  // ── Clarification resume check ─────────────────────────────────────────────
  const { email: botEmail, botAccountId } = deps.identity.jira;
  const timeoutMs = deps.behaviour.clarificationTimeoutHours * 60 * 60 * 1000;

  const pendingStories = state.getStoriesAtStep("clarification-pending");

  for (const story of pendingStories) {
    const { issueKey } = story;

    if (has(issueKey)) {
      log.debug("poller.skip-in-flight", { issueKey });
      continue;
    }

    let comments: Awaited<ReturnType<typeof deps.jira.getComments>>;
    try {
      comments = await deps.jira.getComments(issueKey);
    } catch (err) {
      log.warn("poller.clarification-check-error", { issueKey, err: String(err) });
      continue;
    }

    // Find the step's started_at so we can ignore comments that were posted
    // before the question was asked (e.g. pre-existing thread activity).
    const history = state.getStepHistory(issueKey);
    const pendingStep = [...history].reverse().find((s) => s.step === "clarification-pending");
    if (!pendingStep) {
      // State is inconsistent — stories table says clarification-pending but
      // steps table has no matching row. Skip rather than falling back to an
      // unrelated timestamp, which would misfire on old comments or timeouts.
      log.warn("poller.clarification-step-missing", { issueKey });
      continue;
    }
    const pendingStartedAt = pendingStep.startedAt;

    // Identify human responses. When botAccountId is configured, match on
    // accountId (reliable even when Jira email visibility is restricted).
    // Fall back to email comparison for deployments without the account ID set.
    const isHumanComment = (c: Awaited<ReturnType<typeof deps.jira.getComments>>[number]) =>
      botAccountId ? c.accountId !== botAccountId : c.author !== botEmail;

    const humanResponse = comments.find(
      (c) => isHumanComment(c) && new Date(c.created).getTime() > pendingStartedAt,
    );

    if (humanResponse) {
      log.info("poller.clarification-resolved", { issueKey });
      runStoryWithLock(
        issueKey,
        () => runStory({ issueKey, state, ...ctxBase }),
        (err) => {
          log.error("poller.run-story-error", { issueKey, err: String(err) });
        },
      );
      continue;
    }

    if (Date.now() - pendingStartedAt > timeoutMs) {
      log.warn("poller.clarification-timeout", {
        issueKey,
        timeoutHours: deps.behaviour.clarificationTimeoutHours,
      });
      try {
        await deps.jira.commentOnIssue(
          issueKey,
          `*Escalated to human review.*\n\nReason: Clarification timeout — no human response received within ${deps.behaviour.clarificationTimeoutHours} hours.`,
        );
        await deps.jira.transitionIssue(issueKey, "Needs human review");
        // Update state only after both Jira calls succeed. If either call
        // throws, state stays clarification-pending so the next tick retries.
        state.upsertStory(issueKey, "needs-human-review");
      } catch (err) {
        log.error("poller.clarification-timeout-error", { issueKey, err: String(err) });
      }
    }
  }

  recordTick("ok");
}

/**
 * Start the recurring poll interval and return the handle so callers can
 * clear it on shutdown.
 */
export function startPoller(deps: PollerDeps, state: StateStore): ReturnType<typeof setInterval> {
  log.info("poller.start", { intervalMs: deps.behaviour.pollIntervalMs });
  return setInterval(() => {
    // pollTick records "ok"/"error" at its own exit points. The .catch here
    // guards against any exception that escapes pollTick's internal handling.
    void pollTick(deps, state).catch((err: unknown) => {
      recordTick("error");
      log.error("poller.unhandled-error", { err: String(err) });
    });
  }, deps.behaviour.pollIntervalMs);
}
