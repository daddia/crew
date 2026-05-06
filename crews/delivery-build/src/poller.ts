import { searchIssues, getComments, commentOnIssue, transitionIssue } from "./integrations/jira.js";
import { log } from "./observability.js";
import { runStory } from "./workflow.js";
import type { Step, StateStore } from "./state.js";

const TERMINAL_STEPS = new Set<Step>(["in-qa", "needs-human-review"]);

/**
 * Tracks issueKeys whose runStory() call is currently executing.
 * Exported so tests can inspect and reset it between runs.
 */
export const inFlight = new Set<string>();

/**
 * Execute one poll tick: query Jira for eligible To Do stories and fire
 * runStory() for each result.
 *
 * Before dispatching, two deduplication checks are applied:
 * - If the story already has a state record, skip it (non-terminal steps
 *   emit a debug log; terminal steps are silently ignored because Jira
 *   sometimes returns tickets that have already been handed off).
 * - If the story is already running in this process, skip it.
 *
 * Env vars are read on every call so tests can override them without
 * re-importing the module.
 */
export async function pollTick(state: StateStore): Promise<void> {
  const projectKey = process.env["JIRA_PROJECT_KEY"] ?? "";
  const assignee = process.env["JIRA_ASSIGNEE_ACCOUNT_ID"] ?? "";

  if (!projectKey || !assignee) {
    const missing = [
      !projectKey && "JIRA_PROJECT_KEY",
      !assignee && "JIRA_ASSIGNEE_ACCOUNT_ID",
    ].filter(Boolean);
    log.warn("poller.misconfigured", { missing });
    return;
  }

  const jql = `project = "${projectKey}" AND status = "To Do" AND assignee = "${assignee}"`;

  let issues: Array<{ issueKey: string }>;
  try {
    issues = await searchIssues(jql);
  } catch (err) {
    log.warn("poller.search-error", { err: String(err) });
    return;
  }

  for (const { issueKey } of issues) {
    const existing = state.getStory(issueKey);
    if (existing) {
      if (!TERMINAL_STEPS.has(existing.currentStep)) {
        log.debug("poller.skip-in-progress", { issueKey, step: existing.currentStep });
      }
      continue;
    }

    if (inFlight.has(issueKey)) {
      log.debug("poller.skip-in-flight", { issueKey });
      continue;
    }

    inFlight.add(issueKey);
    void runStory({ issueKey, state })
      .catch((err) => {
        log.error("poller.run-story-error", { issueKey, err: String(err) });
      })
      .finally(() => {
        inFlight.delete(issueKey);
      });
  }

  // ── Clarification resume check ─────────────────────────────────────────────
  // For every story parked in clarification-pending, check whether a human
  // has replied. If so, resume the workflow. If the timeout has elapsed with
  // no reply, escalate to human review and update state so we don't re-fire.
  const botEmail = process.env["ATLASSIAN_EMAIL"] ?? "";
  const timeoutHours = parseInt(process.env["CLARIFICATION_TIMEOUT_HOURS"] ?? "24", 10);
  const timeoutMs = timeoutHours * 60 * 60 * 1000;

  const pendingStories = state.getStoriesAtStep("clarification-pending");

  for (const story of pendingStories) {
    const { issueKey } = story;

    if (inFlight.has(issueKey)) {
      log.debug("poller.skip-in-flight", { issueKey });
      continue;
    }

    let comments: Awaited<ReturnType<typeof getComments>>;
    try {
      comments = await getComments(issueKey);
    } catch (err) {
      log.warn("poller.clarification-check-error", { issueKey, err: String(err) });
      continue;
    }

    // Find the step's started_at so we can ignore comments that were posted
    // before the question was asked (e.g. pre-existing thread activity).
    const history = state.getStepHistory(issueKey);
    const pendingStep = [...history].reverse().find((s) => s.step === "clarification-pending");
    const pendingStartedAt = pendingStep?.startedAt ?? story.startedAt;

    const humanResponse = comments.find(
      (c) => c.author !== botEmail && new Date(c.created).getTime() > pendingStartedAt,
    );

    if (humanResponse) {
      log.info("poller.clarification-resolved", { issueKey });
      inFlight.add(issueKey);
      void runStory({ issueKey, state })
        .catch((err) => {
          log.error("poller.run-story-error", { issueKey, err: String(err) });
        })
        .finally(() => {
          inFlight.delete(issueKey);
        });
      continue;
    }

    if (Date.now() - pendingStartedAt > timeoutMs) {
      log.warn("poller.clarification-timeout", { issueKey, timeoutHours });
      // Update state synchronously before the async Jira calls to prevent
      // this story from being re-evaluated on the very next tick.
      state.upsertStory(issueKey, "needs-human-review");
      void (async () => {
        try {
          await commentOnIssue(
            issueKey,
            `*Escalated to human review.*\n\nReason: Clarification timeout — no human response received within ${timeoutHours} hours.`,
          );
          await transitionIssue(issueKey, "Needs human review");
        } catch (err) {
          log.error("poller.clarification-timeout-error", { issueKey, err: String(err) });
        }
      })();
    }
  }
}

/**
 * Start the recurring poll interval and return the handle so callers can
 * clear it on shutdown.
 */
export function startPoller(state: StateStore): ReturnType<typeof setInterval> {
  const intervalMs = parseInt(
    process.env["POLL_INTERVAL_MS"] ?? "300000",
    10,
  );
  log.info("poller.start", { intervalMs });
  return setInterval(() => {
    void pollTick(state);
  }, intervalMs);
}
