import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentInput, AgentResult } from "@daddia/crew";

vi.mock("../src/memory.js", () => ({
  seedEngineerMemory: vi.fn().mockResolvedValue(undefined),
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
}));
vi.mock("../src/integrations/gitlab.js", () => ({
  createMr: vi.fn().mockResolvedValue("https://gitlab.example.com/mr/1"),
  getMrDiff: vi.fn().mockResolvedValue("--- file.ts\n+line"),
  postReviewComment: vi.fn().mockResolvedValue(undefined),
}));

import { runStory } from "../src/workflow.js";
import { engineer } from "../src/agents/engineer/agent.js";
import { seniorEngineer } from "../src/agents/senior-engineer/agent.js";
import { transitionIssue, commentOnIssue } from "../src/integrations/jira.js";
import { createMr } from "../src/integrations/gitlab.js";
import type { StateStore } from "../src/state.js";

const mockEngineer = vi.mocked(engineer.run);
const mockSeniorEngineer = vi.mocked(seniorEngineer.run);
const mockTransition = vi.mocked(transitionIssue);
const mockComment = vi.mocked(commentOnIssue);
const mockCreateMr = vi.mocked(createMr);

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

    // Handoff: transition to "In Review", not "Done".
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "In Review");
    expect(mockTransition).not.toHaveBeenCalledWith("ENG-1", "Done");
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
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "In Review");
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
});
