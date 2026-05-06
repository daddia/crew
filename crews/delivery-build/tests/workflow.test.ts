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
import type { StateStore } from "../src/state.js";

const mockEngineer = vi.mocked(engineer.run);
const mockSeniorEngineer = vi.mocked(seniorEngineer.run);
const mockTransition = vi.mocked(transitionIssue);
const mockComment = vi.mocked(commentOnIssue);

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

  it("runs the happy-path sequence in order and hands off to review", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    const callOrder = [
      mockEngineer.mock.invocationCallOrder[0],
      mockSeniorEngineer.mock.invocationCallOrder[0],
    ] as number[];

    expect(callOrder[0]).toBeLessThan(callOrder[1] as number);

    // Handoff: transition to "In Review", not "Done".
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "In Review");
    expect(mockTransition).not.toHaveBeenCalledWith("ENG-1", "Done");
  });

  it("escalates to human review when engineer fails to implement", async () => {
    mockEngineer.mockResolvedValue(successResult({ success: false }));

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockSeniorEngineer).not.toHaveBeenCalled();
    expect(mockComment).toHaveBeenCalledWith("ENG-1", expect.stringContaining("Escalated"));
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "Needs human review");
  });

  it("runs the address-feedback loop up to REFACTOR_LOOP_CAP times then escalates", async () => {
    const reviewFailResult = successResult({
      success: false,
      artefacts: { comments: ["fix the thing"] },
    });
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(reviewFailResult);

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    // With cap 2: initial review + 2 address+review cycles = 3 total calls.
    const cap = parseInt(process.env["REFACTOR_LOOP_CAP"] ?? "2", 10);
    expect(mockSeniorEngineer.mock.calls.length).toBe(cap + 1);
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "Needs human review");
  });

  it("proceeds to handoff when peer review passes on second iteration", async () => {
    let reviewCall = 0;
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockImplementation(async (_input: AgentInput) => {
      reviewCall++;
      return successResult({ success: reviewCall > 1 });
    });

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockSeniorEngineer).toHaveBeenCalledTimes(2);
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "In Review");
  });
});
