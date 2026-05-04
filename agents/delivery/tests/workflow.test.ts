import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentInput, AgentResult } from "@daddia/contracts";

vi.mock("../src/memory.js", () => ({
  seedProjectMemory: vi.fn().mockResolvedValue(undefined),
}));

// Mock all three agents before importing workflow.
vi.mock("../src/agents/engineer/agent.js", () => ({
  engineer: { name: "engineer", run: vi.fn() },
}));
vi.mock("../src/agents/senior-engineer/agent.js", () => ({
  seniorEngineer: { name: "senior-engineer", run: vi.fn() },
}));
vi.mock("../src/agents/tech-lead/agent.js", () => ({
  techLead: { name: "tech-lead", run: vi.fn() },
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
import { techLead } from "../src/agents/tech-lead/agent.js";
import { transitionIssue, commentOnIssue } from "../src/integrations/jira.js";
import type { StateStore } from "../src/state.js";

const mockEngineer = vi.mocked(engineer.run);
const mockSeniorEngineer = vi.mocked(seniorEngineer.run);
const mockTechLead = vi.mocked(techLead.run);
const mockTransition = vi.mocked(transitionIssue);
const mockComment = vi.mocked(commentOnIssue);

function makeState(refactorCount = 0): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    startPhase: vi.fn(),
    finishPhase: vi.fn(),
    getPhaseHistory: vi.fn().mockReturnValue([]),
    countRefactorIterations: vi.fn().mockReturnValue(refactorCount),
    close: vi.fn(),
    db: {} as never,
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

  it("runs the happy-path sequence in order", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());
    mockTechLead.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    const callOrder = [
      mockEngineer.mock.invocationCallOrder[0],
      mockSeniorEngineer.mock.invocationCallOrder[0],
      mockTechLead.mock.invocationCallOrder[0],
    ] as number[];

    expect(callOrder[0]).toBeLessThan(callOrder[1] as number);
    expect(callOrder[1]).toBeLessThan(callOrder[2] as number);

    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "Done");
  });

  it("escalates to human review when engineer fails", async () => {
    mockEngineer.mockResolvedValue(successResult({ success: false }));

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockSeniorEngineer).not.toHaveBeenCalled();
    expect(mockTechLead).not.toHaveBeenCalled();
    expect(mockComment).toHaveBeenCalledWith("ENG-1", expect.stringContaining("Escalated"));
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "Needs human review");
  });

  it("runs the address-feedback loop up to REFACTOR_LOOP_CAP times", async () => {
    // Peer review always requests changes; engineer always addresses partially.
    const reviewFailResult = successResult({
      success: false,
      artefacts: { comments: ["fix the thing"] },
    });
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(reviewFailResult);

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    // Senior engineer is called once per loop iteration.
    // With cap 2: initial review + 2 address+review cycles = 3 total calls.
    // But after cap exhaustion we escalate, so senior engineer = cap + 1.
    const cap = parseInt(process.env["REFACTOR_LOOP_CAP"] ?? "2", 10);
    expect(mockSeniorEngineer.mock.calls.length).toBe(cap + 1);
    expect(mockTechLead).not.toHaveBeenCalled();
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "Needs human review");
  });

  it("proceeds to tech-lead when peer review passes on second iteration", async () => {
    let reviewCall = 0;
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockImplementation(async (_input: AgentInput) => {
      reviewCall++;
      return successResult({ success: reviewCall > 1 });
    });
    mockTechLead.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockSeniorEngineer).toHaveBeenCalledTimes(2);
    // tech-lead is invoked twice in the happy path: once for final-code-review
    // and once for stakeholder-review.
    expect(mockTechLead).toHaveBeenCalledTimes(2);
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "Done");
  });

  it("escalates when tech-lead rejects", async () => {
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());
    mockTechLead.mockResolvedValue(
      successResult({ success: false, artefacts: { blockers: ["arch issue"] } }),
    );

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state });

    expect(mockComment).toHaveBeenCalledWith("ENG-1", expect.stringContaining("Escalated"));
    expect(mockTransition).toHaveBeenCalledWith("ENG-1", "Needs human review");
  });
});
