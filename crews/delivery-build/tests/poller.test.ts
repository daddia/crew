import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/workflow.js", () => ({
  runStory: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/observability.js", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { pollTick, startPoller } from "../src/poller.js";
import { inFlight } from "../src/in-flight.js";
import { runStory } from "../src/workflow.js";
import { log } from "../src/observability.js";
import type { StateStore, Step, StepRow } from "../src/state.js";
import type { PollerDeps } from "../src/poller.js";
import type { JiraClient } from "../src/integrations/jira.js";
import type { GitlabClient } from "../src/integrations/gitlab.js";

const mockRunStory = vi.mocked(runStory);
const mockLogWarn = vi.mocked(log.warn);
const mockLogDebug = vi.mocked(log.debug);

function makeMockJira(overrides: Partial<JiraClient> = {}): JiraClient {
  return {
    searchIssues: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
    commentOnIssue: vi.fn().mockResolvedValue(undefined),
    transitionIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeMockGitlab(): GitlabClient {
  return {
    createMr: vi.fn(),
    getPipelineStatus: vi.fn(),
    getMrDiff: vi.fn(),
    postReviewComment: vi.fn(),
  };
}

function makePollerDeps(overrides: Partial<PollerDeps> = {}): PollerDeps {
  return {
    identity: {
      jira: {
        projectKey: "CREW",
        assigneeAccountId: "user-123",
        email: "bot@example.com",
      },
    },
    behaviour: {
      pollIntervalMs: 300_000,
      clarificationTimeoutHours: 24,
      refactorLoopCap: 2,
      ciRetryCap: 3,
      ciPollIntervalMs: 30_000,
    },
    jira: makeMockJira(),
    gitlab: makeMockGitlab(),
    projectDir: "/project",
    ...overrides,
  };
}

function makeState(getStoryImpl?: (key: string) => { issueKey: string; currentStep: Step; startedAt: number } | undefined): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn().mockImplementation(getStoryImpl ?? (() => undefined)),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countRefactorIterations: vi.fn().mockReturnValue(0),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  };
}

function makeStoryRow(issueKey: string, currentStep: Step) {
  return { issueKey, currentStep, startedAt: Date.now() };
}

describe("pollTick", () => {
  beforeEach(() => {
    inFlight.clear();
    mockRunStory.mockReset().mockResolvedValue(undefined);
    mockLogWarn.mockReset();
    mockLogDebug.mockReset();
  });

  it("logs a warn and skips the search when projectKey is not set", async () => {
    const deps = makePollerDeps({
      identity: { jira: { projectKey: "", assigneeAccountId: "user-123", email: "bot@example.com" } },
    });
    await pollTick(deps, makeState());
    expect(deps.jira.searchIssues).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      "poller.misconfigured",
      expect.objectContaining({ missing: ["identity.jira.projectKey"] }),
    );
  });

  it("logs a warn and skips the search when assigneeAccountId is not set", async () => {
    const deps = makePollerDeps({
      identity: { jira: { projectKey: "CREW", assigneeAccountId: "", email: "bot@example.com" } },
    });
    await pollTick(deps, makeState());
    expect(deps.jira.searchIssues).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      "poller.misconfigured",
      expect.objectContaining({ missing: ["identity.jira.assigneeAccountId"] }),
    );
  });

  it("executes a JQL search for the configured project and assignee", async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);

    await pollTick(deps, makeState());

    expect(deps.jira.searchIssues).toHaveBeenCalledWith(
      'project = "CREW" AND status = "To Do" AND assignee = "user-123"',
    );
  });

  it("calls runStory asynchronously for each result returned by the search", async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([
      { issueKey: "CREW-1" },
      { issueKey: "CREW-2" },
    ]);
    const state = makeState();

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).toHaveBeenCalledTimes(2);
    expect(mockRunStory).toHaveBeenCalledWith(expect.objectContaining({ issueKey: "CREW-1", state }));
    expect(mockRunStory).toHaveBeenCalledWith(expect.objectContaining({ issueKey: "CREW-2", state }));
  });

  it("logs a warn-level message and does not throw when the Jira search fails", async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockRejectedValue(new Error("network error"));

    await expect(pollTick(deps, makeState())).resolves.toBeUndefined();

    expect(mockLogWarn).toHaveBeenCalledWith(
      "poller.search-error",
      expect.objectContaining({ err: expect.any(String) }),
    );
    expect(mockRunStory).not.toHaveBeenCalled();
  });

  it("skips an in-progress story and emits a debug log", async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: "CREW-60-001" }]);
    const state = makeState(() => makeStoryRow("CREW-60-001", "implement"));

    await pollTick(deps, state);

    expect(mockRunStory).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      "poller.skip-in-progress",
      expect.objectContaining({ issueKey: "CREW-60-001", step: "implement" }),
    );
  });

  it("skips a terminal story silently without calling runStory", async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: "CREW-60-003" }]);
    const state = makeState(() => makeStoryRow("CREW-60-003", "in-qa"));

    await pollTick(deps, state);

    expect(mockRunStory).not.toHaveBeenCalled();
    expect(mockLogDebug).not.toHaveBeenCalled();
  });

  it("also skips silently when the terminal step is needs-human-review", async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: "CREW-60-003" }]);
    const state = makeState(() => makeStoryRow("CREW-60-003", "needs-human-review"));

    await pollTick(deps, state);

    expect(mockRunStory).not.toHaveBeenCalled();
    expect(mockLogDebug).not.toHaveBeenCalled();
  });

  it("skips an in-flight issueKey and emits a debug log", async () => {
    inFlight.add("CREW-60-004");
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: "CREW-60-004" }]);

    await pollTick(deps, makeState());

    expect(mockRunStory).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      "poller.skip-in-flight",
      expect.objectContaining({ issueKey: "CREW-60-004" }),
    );
  });

  it("calls runStory for a new story with no state record and no in-flight lock", async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: "CREW-60-002" }]);
    const state = makeState(() => undefined);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).toHaveBeenCalledWith(expect.objectContaining({ issueKey: "CREW-60-002", state }));
  });

  it("removes the issueKey from inFlight after runStory settles", async () => {
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([{ issueKey: "CREW-NEW" }]);

    await pollTick(deps, makeState());
    await new Promise((r) => setTimeout(r, 0));

    expect(inFlight.has("CREW-NEW")).toBe(false);
  });

  // ── Clarification resume ─────────────────────────────────────────────────

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
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P1", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([
      { accountId: "acc-human", author: "human@example.com", body: "Here is the answer.", created: new Date(pendingStartedAt + 500).toISOString() },
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).toHaveBeenCalledWith(expect.objectContaining({ issueKey: "CREW-P1", state }));
  });

  it("does not resume when the only post-question comment is from the bot", async () => {
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P2", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([
      { accountId: "acc-bot", author: "bot@example.com", body: "Questions from the engineer.", created: new Date(pendingStartedAt + 200).toISOString() },
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).not.toHaveBeenCalled();
  });

  it("does not resume when human comment predates the clarification question", async () => {
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P3", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([
      { accountId: "acc-human", author: "human@example.com", body: "Old comment.", created: new Date(pendingStartedAt - 500).toISOString() },
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).not.toHaveBeenCalled();
  });

  it("escalates and transitions to Needs Human Review when timeout elapses with no reply", async () => {
    const pendingStartedAt = Date.now() - 25 * 60 * 60 * 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P4", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.jira.commentOnIssue).toHaveBeenCalledWith("CREW-P4", expect.stringContaining("Clarification timeout"));
    expect(deps.jira.transitionIssue).toHaveBeenCalledWith("CREW-P4", "Needs human review");
    expect(vi.mocked(state.upsertStory)).toHaveBeenCalledWith("CREW-P4", "needs-human-review");
  });

  it("updates state to needs-human-review only after both Jira calls succeed on timeout", async () => {
    const pendingStartedAt = Date.now() - 25 * 60 * 60 * 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    vi.mocked(deps.jira.commentOnIssue).mockRejectedValueOnce(new Error("Jira unavailable"));
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P4B", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([]);

    await pollTick(deps, state);

    expect(vi.mocked(state.upsertStory)).not.toHaveBeenCalledWith("CREW-P4B", "needs-human-review");
  });

  it("does not escalate when timeout has not elapsed", async () => {
    const pendingStartedAt = Date.now() - 1 * 60 * 60 * 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P5", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.jira.commentOnIssue).not.toHaveBeenCalled();
    expect(deps.jira.transitionIssue).not.toHaveBeenCalledWith("CREW-P5", "Needs human review");
  });

  it("defaults clarificationTimeoutHours to 24 via behaviour config", async () => {
    const pendingStartedAt = Date.now() - 23 * 60 * 60 * 1000;
    const deps = makePollerDeps({ behaviour: { pollIntervalMs: 300_000, clarificationTimeoutHours: 24, refactorLoopCap: 2, ciRetryCap: 3, ciPollIntervalMs: 30_000 } });
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-P6", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.jira.commentOnIssue).not.toHaveBeenCalled();
  });

  it("skips a clarification-pending story that is already in-flight", async () => {
    inFlight.add("CREW-INFLIGHT");
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-INFLIGHT", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([
      { accountId: "acc-human", author: "human@example.com", body: "Answer", created: new Date(pendingStartedAt + 500).toISOString() },
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).not.toHaveBeenCalled();
  });

  it("logs warn and skips when the clarification-pending step row is missing from history", async () => {
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-CORRUPT", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([
      { accountId: "acc-human", author: "human@example.com", body: "Answer", created: new Date(pendingStartedAt + 500).toISOString() },
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      "poller.clarification-step-missing",
      expect.objectContaining({ issueKey: "CREW-CORRUPT" }),
    );
  });

  it("uses accountId for bot detection when botAccountId is configured", async () => {
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps({
      identity: {
        jira: {
          projectKey: "CREW",
          assigneeAccountId: "user-123",
          email: "bot@example.com",
          botAccountId: "bot-account-id",
        },
      },
    });
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-BOTID", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    vi.mocked(deps.jira.getComments).mockResolvedValue([
      { accountId: "bot-account-id", author: "some-display-name", body: "Bot reply.", created: new Date(pendingStartedAt + 200).toISOString() },
    ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).not.toHaveBeenCalled();
  });

  it("continues checking remaining pending stories when getComments fails for one", async () => {
    const pendingStartedAt = Date.now() - 1000;
    const deps = makePollerDeps();
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const state = makeState();
    vi.mocked(state.getStoriesAtStep).mockReturnValue([
      { issueKey: "CREW-FAIL", currentStep: "clarification-pending", startedAt: pendingStartedAt },
      { issueKey: "CREW-OK", currentStep: "clarification-pending", startedAt: pendingStartedAt },
    ]);
    vi.mocked(state.getStepHistory).mockReturnValue([makePendingStep(pendingStartedAt)]);
    vi.mocked(deps.jira.getComments)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce([
        { accountId: "acc-human", author: "human@example.com", body: "Answer", created: new Date(pendingStartedAt + 500).toISOString() },
      ]);

    await pollTick(deps, state);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRunStory).toHaveBeenCalledWith(expect.objectContaining({ issueKey: "CREW-OK", state }));
    expect(mockRunStory).not.toHaveBeenCalledWith(expect.objectContaining({ issueKey: "CREW-FAIL" }));
  });
});

describe("startPoller", () => {
  beforeEach(() => {
    inFlight.clear();
    vi.useFakeTimers();
    mockRunStory.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires at the configured pollIntervalMs", async () => {
    const deps = makePollerDeps({ behaviour: { pollIntervalMs: 300_000, clarificationTimeoutHours: 24, refactorLoopCap: 2, ciRetryCap: 3, ciPollIntervalMs: 30_000 } });
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const interval = startPoller(deps, makeState());

    await vi.advanceTimersByTimeAsync(299999);
    expect(deps.jira.searchIssues).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(deps.jira.searchIssues).toHaveBeenCalledTimes(1);

    clearInterval(interval);
  });

  it("respects a custom pollIntervalMs", async () => {
    const deps = makePollerDeps({ behaviour: { pollIntervalMs: 5000, clarificationTimeoutHours: 24, refactorLoopCap: 2, ciRetryCap: 3, ciPollIntervalMs: 30_000 } });
    vi.mocked(deps.jira.searchIssues).mockResolvedValue([]);
    const interval = startPoller(deps, makeState());

    await vi.advanceTimersByTimeAsync(4999);
    expect(deps.jira.searchIssues).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(deps.jira.searchIssues).toHaveBeenCalledTimes(1);

    clearInterval(interval);
  });

  it("stops polling after the returned interval handle is cleared", async () => {
    const deps = makePollerDeps();
    const interval = startPoller(deps, makeState());
    clearInterval(interval);

    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(deps.jira.searchIssues).not.toHaveBeenCalled();
  });
});
