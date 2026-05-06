import { searchIssues } from "./integrations/jira.js";
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
