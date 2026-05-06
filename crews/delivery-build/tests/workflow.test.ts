import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentInput, AgentResult } from "@daddia/crew";

vi.mock("../src/memory.js", () => ({
  seedEngineerMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/observability.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../src/agents/engineer/agent.js", () => ({
  engineer: { name: "engineer", run: vi.fn() },
}));
vi.mock("../src/agents/senior-engineer/agent.js", () => ({
  seniorEngineer: { name: "senior-engineer", run: vi.fn() },
}));
vi.mock("../src/integrations/jira.js", () => ({
  transitionIssue: vi.fn().mockResolvedValue(undefined),
  commentOnIssue: vi.fn().mockResolvedValue(undefined),
  getIssue: vi.fn().mockResolvedValue({
    summary: "Test Story",
    description: "Do the work.",
    acceptanceCriteria: null,
  }),
}));
vi.mock("../src/integrations/gitlab.js", () => ({
  createMr: vi.fn().mockResolvedValue("https://gitlab.example.com/mr/1"),
  getMrDiff: vi.fn().mockResolvedValue("--- file.ts\n+line"),
  postReviewComment: vi.fn().mockResolvedValue(undefined),
  getPipelineStatus: vi.fn().mockResolvedValue("success"),
}));

import { runStory } from "../src/workflow.js";
import { log } from "../src/observability.js";
import { engineer } from "../src/agents/engineer/agent.js";
import { seniorEngineer } from "../src/agents/senior-engineer/agent.js";
import { transitionIssue, commentOnIssue, getIssue } from "../src/integrations/jira.js";
import { createMr, getPipelineStatus } from "../src/integrations/gitlab.js";
import type { StateStore } from "../src/state.js";

const mockEngineer = vi.mocked(engineer.run);
const mockSeniorEngineer = vi.mocked(seniorEngineer.run);
const mockTransition = vi.mocked(transitionIssue);
const mockComment = vi.mocked(commentOnIssue);
const mockCreateMr = vi.mocked(createMr);
const mockGetIssue = vi.mocked(getIssue);
const mockGetPipelineStatus = vi.mocked(getPipelineStatus);
const mockLogInfo = vi.mocked(log.info);

function makeState(refactorCount = 0): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countRefactorIterations: vi.fn().mockReturnValue(refactorCount),
    close: vi.fn(),
  };
}

function successResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    summary: "ok",
    artefacts: { branchName: "feature/ENG-1-test", title: "Test" },
    costUsd: 0.01,
    ...overrides,
  };
}

describe("runStory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Skip the real 30-second wait in all tests by default.
    process.env["CI_POLL_INTERVAL_MS"] = "0";
    // Restore the default CI status so tests that override it don't bleed through.
    mockGetPipelineStatus.mockResolvedValue("success");
  });

  it("runs the happy-path sequence: implement then peer-review then MR", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    const engineerOrder = mockEngineer.mock.invocationCallOrder[0] as number;
    const reviewOrder = mockSeniorEngineer.mock.invocationCallOrder[0] as number;
    const createMrOrder = mockCreateMr.mock.invocationCallOrder[0] as number;

    expect(engineerOrder).toBeLessThan(reviewOrder);
    expect(reviewOrder).toBeLessThan(createMrOrder);

    // Handoff: transition to "In QA"; legacy "In Review" must not be called.
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "In QA");
    expect(mockTransition).not.toHaveBeenCalledWith("ENG-1", "In Review");
  });

  it("calls createMr() once after seniorEngineer returns success", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockCreateMr).toHaveBeenCalledTimes(1);
    expect(mockSeniorEngineer.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateMr.mock.invocationCallOrder[0] as number,
    );
  });

  it("escalates to human review when engineer fails to implement", async () => {
    mockEngineer.mockResolvedValue(successResult({ success: false }));

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockSeniorEngineer).not.toHaveBeenCalled();
    expect(mockCreateMr).not.toHaveBeenCalled();
    expect(mockComment).toHaveBeenCalledWith("ENG-1", expect.stringContaining("Escalated"));
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "Needs human review");
  });

  it("does not open MR when loop cap is exceeded", async () => {
    const reviewFailResult = successResult({
      success: false,
      artefacts: { branchName: "feature/ENG-1-test", comments: ["fix the thing"] },
    });
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(reviewFailResult);

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    // With cap 2: initial review + 2 address+review cycles = 3 total calls.
    const cap = parseInt(process.env["REFACTOR_LOOP_CAP"] ?? "2", 10);
    expect(mockSeniorEngineer.mock.calls.length).toBe(cap + 1);
    expect(mockCreateMr).not.toHaveBeenCalled();
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "Needs human review");
  });

  it("opens MR and hands off when peer review passes on second iteration", async () => {
    let reviewCall = 0;
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockImplementation(async (_input: AgentInput) => {
      reviewCall++;
      return successResult({ success: reviewCall > 1 });
    });

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    // Engineer is called once for implement and once for address-feedback.
    expect(mockEngineer).toHaveBeenCalledTimes(2);
    expect(mockSeniorEngineer).toHaveBeenCalledTimes(2);
    expect(mockCreateMr).toHaveBeenCalledTimes(1);
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "In QA");
  });

  it("passes branchName (not mrUrl) to senior engineer during peer review", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockSeniorEngineer).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ task: "peer-code-review", branchName: "feature/ENG-1-test" }),
      }),
    );
  });

  it("calls getIssue before engineer.run() for the implement task", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockGetIssue).toHaveBeenCalledWith("ENG-1");
    expect(mockGetIssue.mock.invocationCallOrder[0]).toBeLessThan(
      mockEngineer.mock.invocationCallOrder[0] as number,
    );
  });

  it("passes context.ticket to engineer for the implement task", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    const implementCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "implement-story",
    );
    expect(implementCall).toBeDefined();
    expect((implementCall![0] as AgentInput).context["ticket"]).toMatchObject({
      summary: "Test Story",
      description: "Do the work.",
    });
  });

  it("proceeds with ticket: null when getIssue throws and emits a warn log", async () => {
    mockGetIssue.mockRejectedValueOnce(new Error("network error"));
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    const implementCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "implement-story",
    );
    expect(implementCall).toBeDefined();
    expect((implementCall![0] as AgentInput).context["ticket"]).toBeNull();
  });

  it("passes branchName to engineer during address-feedback", async () => {
    let reviewCall = 0;
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockImplementation(async (_input: AgentInput) => {
      reviewCall++;
      return successResult({ success: reviewCall > 1, artefacts: { branchName: "feature/ENG-1-test", comments: ["fix x"] } });
    });

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    const addressFeedbackCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "address-feedback",
    );
    expect(addressFeedbackCall).toBeDefined();
    expect((addressFeedbackCall![0] as AgentInput).context["branchName"]).toBe("feature/ENG-1-test");
  });

  // ── CI monitoring loop ───────────────────────────────────────────────────

  it("polls pipeline after MR opens and proceeds when CI is green", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());
    // default mock returns "success"

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockGetPipelineStatus).toHaveBeenCalledWith("https://gitlab.example.com/mr/1");
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "In QA");
  });

  it("calls engineer with task fix-ci on pipeline failure then proceeds on success", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());
    // First poll: failed; second poll: success
    mockGetPipelineStatus
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("success");

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    const ciFixCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "fix-ci",
    );
    expect(ciFixCall).toBeDefined();
    expect((ciFixCall![0] as AgentInput).context["mrUrl"]).toBe("https://gitlab.example.com/mr/1");
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "In QA");
  });

  it("escalates when CI fix cap is exceeded without success", async () => {
    process.env["CI_RETRY_CAP"] = "2";
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());
    mockGetPipelineStatus.mockResolvedValue("failed");

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    const ciFixCalls = mockEngineer.mock.calls.filter(
      (call) => (call[0] as AgentInput).context["task"] === "fix-ci",
    );
    expect(ciFixCalls).toHaveLength(2);
    expect(mockComment).toHaveBeenCalledWith("ENG-1", expect.stringContaining("Escalated"));
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "Needs human review");
    expect(mockTransition).not.toHaveBeenCalledWith("ENG-1", "In Review");

    delete process.env["CI_RETRY_CAP"];
  });

  it("re-polls pipeline when status is running before checking again", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());
    // First poll: running; second poll: success
    mockGetPipelineStatus
      .mockResolvedValueOnce("running")
      .mockResolvedValueOnce("success");

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockGetPipelineStatus).toHaveBeenCalledTimes(2);
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "In QA");
  });

  it("passes context.ticket to engineer for the address-feedback task", async () => {
    let reviewCall = 0;
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockImplementation(async (_input: AgentInput) => {
      reviewCall++;
      return successResult({ success: reviewCall > 1, artefacts: { branchName: "feature/ENG-1-test", comments: ["fix x"] } });
    });

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    const addressFeedbackCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "address-feedback",
    );
    expect(addressFeedbackCall).toBeDefined();
    expect((addressFeedbackCall![0] as AgentInput).context["ticket"]).toMatchObject({
      summary: "Test Story",
    });
  });

  // ── In QA handoff ─────────────────────────────────────────────────────────

  it("emits workflow.handoff-to-qa log after transitioning to In QA", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockLogInfo).toHaveBeenCalledWith(
      "workflow.handoff-to-qa",
      expect.objectContaining({ issueKey: "ENG-1", mrUrl: "https://gitlab.example.com/mr/1" }),
    );
  });

  it("never transitions to In Review in the normal workflow path", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockTransition).not.toHaveBeenCalledWith("ENG-1", "In Review");
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "In QA");
  });
});
