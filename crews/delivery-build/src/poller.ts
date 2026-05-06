import { searchIssues } from "./integrations/jira.js";
import { log } from "./observability.js";
import { runStory } from "./workflow.js";
import type { StateStore } from "./state.js";

/**
 * Execute one poll tick: query Jira for eligible To Do stories and fire
 * runStory() for each result.
 *
 * Env vars read on every call so that tests can override them without
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
    void runStory({ issueKey, state }).catch((err) => {
      log.error("poller.run-story-error", { issueKey, err: String(err) });
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
