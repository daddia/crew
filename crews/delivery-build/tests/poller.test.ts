import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Set env vars before the module is first imported so module-level reads pick
// them up. Each test that needs different values resets them locally.
process.env["JIRA_PROJECT_KEY"] = "CREW";
process.env["JIRA_ASSIGNEE_ACCOUNT_ID"] = "user-123";

vi.mock("../src/integrations/jira.js", () => ({
  searchIssues: vi.fn(),
}));
vi.mock("../src/workflow.js", () => ({
  runStory: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/observability.js", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { pollTick, startPoller, inFlight } from "../src/poller.js";
import { searchIssues } from "../src/integrations/jira.js";
import { runStory } from "../src/workflow.js";
import { log } from "../src/observability.js";
import type { StateStore, Step } from "../src/state.js";

const mockSearchIssues = vi.mocked(searchIssues);
const mockRunStory = vi.mocked(runStory);
const mockLogWarn = vi.mocked(log.warn);
const mockLogDebug = vi.mocked(log.debug);

function makeState(getStoryImpl?: (key: string) => { issueKey: string; currentStep: Step; startedAt: number } | undefined): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn().mockImplementation(getStoryImpl ?? (() => undefined)),
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
    mockRunStory.mockReset().mockResolvedValue(undefined);
    mockLogWarn.mockReset();
    mockLogDebug.mockReset();
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
