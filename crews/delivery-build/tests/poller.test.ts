import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Set env vars before the module is first imported so module-level reads pick
// them up. Each test that needs different values resets them locally.
process.env["JIRA_PROJECT_KEY"] = "CREW";
process.env["JIRA_ASSIGNEE_ACCOUNT_ID"] = "user-123";
process.env["ATLASSIAN_EMAIL"] = "bot@example.com";

vi.mock("../src/integrations/jira.js", () => ({
  searchIssues: vi.fn(),
  getComments: vi.fn(),
  commentOnIssue: vi.fn().mockResolvedValue(undefined),
  transitionIssue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/workflow.js", () => ({
  runStory: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/observability.js", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { pollTick, startPoller, inFlight } from "../src/poller.js";
import { searchIssues, getComments, commentOnIssue, transitionIssue } from "../src/integrations/jira.js";
import { runStory } from "../src/workflow.js";
import { log } from "../src/observability.js";
import type { StateStore, Step, StepRow } from "../src/state.js";

const mockSearchIssues = vi.mocked(searchIssues);
const mockGetComments = vi.mocked(getComments);
const mockCommentOnIssue = vi.mocked(commentOnIssue);
const mockTransitionIssue = vi.mocked(transitionIssue);
const mockRunStory = vi.mocked(runStory);
const mockLogWarn = vi.mocked(log.warn);
const mockLogDebug = vi.mocked(log.debug);

function makeState(getStoryImpl?: (key: string) => { issueKey: string; currentStep: Step; startedAt: number } | undefined): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn().mockImplementation(getStoryImpl ?? (() => undefined)),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countRefactorIterations: vi.fn().mockReturnValue(0),
    close: vi.fn(),
  };
}

function makeStoryRow(issueKey: string, currentStep: Step) {
  return { issueKey, currentStep, startedAt: Date.now() };
}

describe("pollTick", () => {
  beforeEach(() => {
    inFlight.clear();
    mockSearchIssues.mockReset();
    mockGetComments.mockReset().mockResolvedValue([]);
    mockCommentOnIssue.mockReset().mockResolvedValue(undefined);
    mockTransitionIssue.mockReset().mockResolvedValue(undefined);
    mockRunStory.mockReset().mockResolvedValue(undefined);
    mockLogWarn.mockReset();
    mockLogDebug.mockReset();
  });

  it("logs a warn and skips the search when JIRA_PROJECT_KEY is not set", async () => {
    const saved = process.env["JIRA_PROJECT_KEY"];
    delete process.env["JIRA_PROJECT_KEY"];
    try {
      await pollTick(makeState());
      expect(mockSearchIssues).not.toHaveBeenCalled();
      expect(mockLogWarn).toHaveBeenCalledWith(
        "poller.misconfigured",
        expect.objectContaining({ missing: ["JIRA_PROJECT_KEY"] }),
      );
    } finally {
      if (saved !== undefined) process.env["JIRA_PROJECT_KEY"] = saved;
    }
  });

  it("logs a warn and skips the search when JIRA_ASSIGNEE_ACCOUNT_ID is not set", async () => {
    const saved = process.env["JIRA_ASSIGNEE_ACCOUNT_ID"];
    delete process.env["JIRA_ASSIGNEE_ACCOUNT_ID"];
    try {
      await pollTick(makeState());
      expect(mockSearchIssues).not.toHaveBeenCalled();
      expect(mockLogWarn).toHaveBeenCalledWith(
        "poller.misconfigured",
        expect.objectContaining({ missing: ["JIRA_ASSIGNEE_ACCOUNT_ID"] }),
      );
    } finally {
      if (saved !== undefined) process.env["JIRA_ASSIGNEE_ACCOUNT_ID"] = saved;
    }
  });

  it("executes a JQL search for the configured project and assignee", async () => {
    mockSearchIssues.mockResolvedValue([]);

    await pollTick(makeState());

    expect(mockSearchIssues).toHaveBeenCalledWith(
      'project = "CREW" AND status = "To Do" AND assignee = "user-123"',
    );
  });

  it("calls runStory asynchronously for each result returned by the search", async () => {
    mockSearchIssues.mockResolvedValue([
      { issueKey: "CREW-1" },
      { issueKey: "CREW-2" },
    ]);
    const state = makeState();

    await pollTick(state);
    // Flush microtask queue so the fire-and-forget promises resolve.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).toHaveBeenCalledTimes(2);
    expect(mockRunStory).toHaveBeenCalledWith({ issueKey: "CREW-1", state });
    expect(mockRunStory).toHaveBeenCalledWith({ issueKey: "CREW-2", state });
  });

  it("logs a warn-level message and does not throw when the Jira search fails", async () => {
    mockSearchIssues.mockRejectedValue(new Error("network error"));

    await expect(pollTick(makeState())).resolves.toBeUndefined();

    expect(mockLogWarn).toHaveBeenCalledWith(
      "poller.search-error",
      expect.objectContaining({ err: expect.any(String) }),
    );
    expect(mockRunStory).not.toHaveBeenCalled();
  });

  it("skips an in-progress story and emits a debug log", async () => {
    mockSearchIssues.mockResolvedValue([{ issueKey: "CREW-60-001" }]);
    const state = makeState(() => makeStoryRow("CREW-60-001", "implement"));

    await pollTick(state);

    expect(mockRunStory).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      "poller.skip-in-progress",
      expect.objectContaining({ issueKey: "CREW-60-001", step: "implement" }),
    );
  });

  it("skips a terminal story silently without calling runStory", async () => {
    mockSearchIssues.mockResolvedValue([{ issueKey: "CREW-60-003" }]);
    const state = makeState(() => makeStoryRow("CREW-60-003", "in-qa"));

    await pollTick(state);

    expect(mockRunStory).not.toHaveBeenCalled();
    expect(mockLogDebug).not.toHaveBeenCalled();
  });

  it("also skips silently when the terminal step is needs-human-review", async () => {
    mockSearchIssues.mockResolvedValue([{ issueKey: "CREW-60-003" }]);
    const state = makeState(() => makeStoryRow("CREW-60-003", "needs-human-review"));

    await pollTick(state);

    expect(mockRunStory).not.toHaveBeenCalled();
    expect(mockLogDebug).not.toHaveBeenCalled();
  });

  it("skips an in-flight issueKey and emits a debug log", async () => {
    inFlight.add("CREW-60-004");
    mockSearchIssues.mockResolvedValue([{ issueKey: "CREW-60-004" }]);

    await pollTick(makeState());

    expect(mockRunStory).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      "poller.skip-in-flight",
      expect.objectContaining({ issueKey: "CREW-60-004" }),
    );
  });

  it("calls runStory for a new story with no state record and no in-flight lock", async () => {
    mockSearchIssues.mockResolvedValue([{ issueKey: "CREW-60-002" }]);
    const state = makeState(() => undefined);

    await pollTick(state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).toHaveBeenCalledWith({ issueKey: "CREW-60-002", state });
  });

  it("removes the issueKey from inFlight after runStory settles", async () => {
    mockSearchIssues.mockResolvedValue([{ issueKey: "CREW-NEW" }]);

    await pollTick(makeState());
    await new Promise((r) => setTimeout(r, 0));

    expect(inFlight.has("CREW-NEW")).toBe(false);
  });

  // ── Clarification resume (CREW-62-002) ────────────────────────────────────

  function makePendingStep(startedAt: number): StepRow {
    return {
      issueKey: "irrelevant",
      step: "clarification-pending",
      sessionId: null,
      startedAt,
      finishedAt: startedAt + 100,
      costUsd: null,
      verdict: "pending",
    };
  }

  it("calls runStory to resume when a human comment is found after the clarification question", async () => {
    const pendingStartedAt = Date.now() - 1000;
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P1", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    mockGetComments.mockResolvedValue([
      { author: "human@example.com", body: "Here is the answer.", created: new Date(pendingStartedAt + 500).toISOString() },
    ]);
    mockSearchIssues.mockResolvedValue([]);

    await pollTick(state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).toHaveBeenCalledWith({ issueKey: "CREW-P1", state });
  });

  it("does not resume when the only post-question comment is from the bot", async () => {
    const pendingStartedAt = Date.now() - 1000;
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P2", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    mockGetComments.mockResolvedValue([
      { author: "bot@example.com", body: "Questions from the engineer.", created: new Date(pendingStartedAt + 200).toISOString() },
    ]);
    mockSearchIssues.mockResolvedValue([]);

    await pollTick(state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).not.toHaveBeenCalled();
  });

  it("does not resume when human comment predates the clarification question", async () => {
    const pendingStartedAt = Date.now() - 1000;
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P3", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    mockGetComments.mockResolvedValue([
      // created is before pendingStartedAt
      { author: "human@example.com", body: "Old comment.", created: new Date(pendingStartedAt - 500).toISOString() },
    ]);
    mockSearchIssues.mockResolvedValue([]);

    await pollTick(state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).not.toHaveBeenCalled();
  });

  it("escalates and transitions to Needs Human Review when timeout elapses with no reply", async () => {
    process.env["CLARIFICATION_TIMEOUT_HOURS"] = "24";
    const pendingStartedAt = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P4", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    mockGetComments.mockResolvedValue([]);
    mockSearchIssues.mockResolvedValue([]);

    await pollTick(state);
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(state.upsertStory)).toHaveBeenCalledWith("CREW-P4", "needs-human-review");
    expect(mockCommentOnIssue).toHaveBeenCalledWith("CREW-P4", expect.stringContaining("Clarification timeout"));
    expect(mockTransitionIssue).toHaveBeenCalledWith("CREW-P4", "Needs human review");

    delete process.env["CLARIFICATION_TIMEOUT_HOURS"];
  });

  it("does not escalate when timeout has not elapsed", async () => {
    process.env["CLARIFICATION_TIMEOUT_HOURS"] = "24";
    const pendingStartedAt = Date.now() - 1 * 60 * 60 * 1000; // 1 hour ago
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P5", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    mockGetComments.mockResolvedValue([]);
    mockSearchIssues.mockResolvedValue([]);

    await pollTick(state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockCommentOnIssue).not.toHaveBeenCalled();
    expect(mockTransitionIssue).not.toHaveBeenCalledWith("CREW-P5", "Needs human review");

    delete process.env["CLARIFICATION_TIMEOUT_HOURS"];
  });

  it("defaults CLARIFICATION_TIMEOUT_HOURS to 24 (86400000 ms)", async () => {
    delete process.env["CLARIFICATION_TIMEOUT_HOURS"];
    // 23 hours ago — should not have timed out at 24h default
    const pendingStartedAt = Date.now() - 23 * 60 * 60 * 1000;
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P6", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    mockGetComments.mockResolvedValue([]);
    mockSearchIssues.mockResolvedValue([]);

    await pollTick(state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockCommentOnIssue).not.toHaveBeenCalled();
  });

  it("skips a clarification-pending story that is already in-flight", async () => {
    inFlight.add("CREW-INFLIGHT");
    const pendingStartedAt = Date.now() - 1000;
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-INFLIGHT", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    mockGetComments.mockResolvedValue([
      { author: "human@example.com", body: "Answer", created: new Date(pendingStartedAt + 500).toISOString() },
    ]);
    mockSearchIssues.mockResolvedValue([]);

    await pollTick(state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).not.toHaveBeenCalled();
  });

  it("continues checking remaining pending stories when getComments fails for one", async () => {
    const pendingStartedAt = Date.now() - 1000;
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-FAIL", currentStep: "clarification-pending", startedAt: pendingStartedAt },
      { issueKey: "CREW-OK", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    mockGetComments
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce([
        { author: "human@example.com", body: "Answer", created: new Date(pendingStartedAt + 500).toISOString() },
      ]);
    mockSearchIssues.mockResolvedValue([]);

    await pollTick(state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).toHaveBeenCalledWith({ issueKey: "CREW-OK", state });
    expect(mockRunStory).not.toHaveBeenCalledWith({ issueKey: "CREW-FAIL", state });
  });
});

describe("startPoller", () => {
  let savedInterval: string | undefined;

  beforeEach(() => {
    inFlight.clear();
    vi.useFakeTimers();
    mockSearchIssues.mockReset().mockResolvedValue([]);
    savedInterval = process.env["POLL_INTERVAL_MS"];
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedInterval !== undefined) {
      process.env["POLL_INTERVAL_MS"] = savedInterval;
    } else {
      delete process.env["POLL_INTERVAL_MS"];
    }
  });

  it("defaults to a 300000ms interval when POLL_INTERVAL_MS is not set", async () => {
    delete process.env["POLL_INTERVAL_MS"];
    const interval = startPoller(makeState());

    await vi.advanceTimersByTimeAsync(299999);
    expect(mockSearchIssues).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockSearchIssues).toHaveBeenCalledTimes(1);

    clearInterval(interval);
  });

  it("respects a custom POLL_INTERVAL_MS value", async () => {
    process.env["POLL_INTERVAL_MS"] = "5000";
    const interval = startPoller(makeState());

    await vi.advanceTimersByTimeAsync(4999);
    expect(mockSearchIssues).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockSearchIssues).toHaveBeenCalledTimes(1);

    clearInterval(interval);
  });

  it("stops polling after the returned interval handle is cleared", async () => {
    const interval = startPoller(makeState());
    clearInterval(interval);

    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(mockSearchIssues).not.toHaveBeenCalled();
  });
});
