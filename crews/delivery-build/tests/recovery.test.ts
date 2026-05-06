import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/observability.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  unstable_v2_resumeSession: vi.fn(),
}));

vi.mock("../src/agents/engineer/agent.js", () => ({
  engineer: { name: "engineer", run: vi.fn() },
}));
vi.mock("../src/agents/senior-engineer/agent.js", () => ({
  seniorEngineer: { name: "senior-engineer", run: vi.fn() },
}));
vi.mock("../src/memory.js", () => ({
  seedEngineerMemory: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/integrations/jira.js", () => ({
  transitionIssue: vi.fn().mockResolvedValue(undefined),
  commentOnIssue: vi.fn().mockResolvedValue(undefined),
  getIssue: vi.fn().mockResolvedValue({ summary: "Test", description: "desc", acceptanceCriteria: null }),
}));
vi.mock("../src/integrations/gitlab.js", () => ({
  createMr: vi.fn().mockResolvedValue("https://gitlab.example.com/mr/1"),
  getMrDiff: vi.fn().mockResolvedValue(""),
  postReviewComment: vi.fn().mockResolvedValue(undefined),
  getPipelineStatus: vi.fn().mockResolvedValue("success"),
}));

import { recoverInterruptedSteps } from "../src/workflow.js";
import { unstable_v2_resumeSession } from "@anthropic-ai/claude-agent-sdk";
import { log } from "../src/observability.js";
import { commentOnIssue, transitionIssue } from "../src/integrations/jira.js";
import { engineer } from "../src/agents/engineer/agent.js";
import { seniorEngineer } from "../src/agents/senior-engineer/agent.js";
import type { StateStore, StepRow } from "../src/state.js";

const mockResumeSession = vi.mocked(unstable_v2_resumeSession);
const mockLogInfo = vi.mocked(log.info);
const mockLogWarn = vi.mocked(log.warn);
const mockComment = vi.mocked(commentOnIssue);
const mockTransition = vi.mocked(transitionIssue);
const mockEngineer = vi.mocked(engineer.run);
const mockSeniorEngineer = vi.mocked(seniorEngineer.run);

function makeInterruptedRow(overrides: Partial<StepRow> = {}): StepRow {
  return {
    issueKey: "CREW-63-001",
    step: "implement",
    sessionId: "sess_abc",
    startedAt: Date.now() - 5000,
    finishedAt: null,
    costUsd: null,
    verdict: null,
    ...overrides,
  };
}

function makeSuccessResult() {
  return {
    success: true,
    summary: "ok",
    artefacts: { branchName: "feature/CREW-63-001-test", title: "Test" },
    costUsd: 0.01,
  };
}

function makeState(interrupted: StepRow[] = []): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countRefactorIterations: vi.fn().mockReturnValue(0),
    checkAndRecord: vi.fn().mockReturnValue(false),
    getInterruptedSteps: vi.fn().mockReturnValue(interrupted),
    close: vi.fn(),
  };
}

describe("recoverInterruptedSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["CI_POLL_INTERVAL_MS"] = "0";
  });

  it("completes silently when there are no interrupted steps", async () => {
    const state = makeState([]);

    await recoverInterruptedSteps(state);

    expect(mockResumeSession).not.toHaveBeenCalled();
    expect(mockLogWarn).not.toHaveBeenCalled();
    expect(mockLogInfo).not.toHaveBeenCalledWith("recovery.session-resumed", expect.anything());
  });

  it("calls unstable_v2_resumeSession with the stored sessionId", async () => {
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
    const state = makeState([makeInterruptedRow({ sessionId: "sess_abc" })]);

    await recoverInterruptedSteps(state);

    expect(mockResumeSession).toHaveBeenCalledWith(
      "sess_abc",
      expect.objectContaining({ model: expect.any(String) }),
    );
  });

  it("emits an info log with issueKey, step, and sessionId on successful resume", async () => {
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
    const state = makeState([
      makeInterruptedRow({ issueKey: "CREW-63-001", step: "implement", sessionId: "sess_abc" }),
    ]);

    await recoverInterruptedSteps(state);

    expect(mockLogInfo).toHaveBeenCalledWith(
      "recovery.session-resumed",
      expect.objectContaining({ issueKey: "CREW-63-001", step: "implement", sessionId: "sess_abc" }),
    );
  });

  it("calls runStory after a successful session resume", async () => {
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
    const state = makeState([makeInterruptedRow({ issueKey: "CREW-63-001" })]);

    await recoverInterruptedSteps(state);

    // runStory drives the workflow; verifying the Jira transition confirms it ran
    expect(mockTransition).toHaveBeenCalledWith("CREW-63-001", "In QA");
  });

  it("emits a warn log and escalates when unstable_v2_resumeSession throws", async () => {
    mockResumeSession.mockImplementation(() => {
      throw new Error("session not found");
    });
    const state = makeState([
      makeInterruptedRow({ issueKey: "CREW-63-001", sessionId: "sess_gone" }),
    ]);

    await recoverInterruptedSteps(state);

    expect(mockLogWarn).toHaveBeenCalledWith(
      "recovery.session-failed",
      expect.objectContaining({ issueKey: "CREW-63-001", sessionId: "sess_gone" }),
    );
    expect(mockComment).toHaveBeenCalledWith("CREW-63-001", expect.stringContaining("Escalated"));
    expect(mockTransition).toHaveBeenCalledWith("CREW-63-001", "Needs human review");
  });

  it("processes all interrupted rows — second row is also attempted after first succeeds", async () => {
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
    const state = makeState([
      makeInterruptedRow({ issueKey: "CREW-63-001", sessionId: "sess_1" }),
      makeInterruptedRow({ issueKey: "CREW-63-002", sessionId: "sess_2" }),
    ]);

    await recoverInterruptedSteps(state);

    expect(mockResumeSession).toHaveBeenCalledTimes(2);
    expect(mockResumeSession).toHaveBeenCalledWith("sess_1", expect.anything());
    expect(mockResumeSession).toHaveBeenCalledWith("sess_2", expect.anything());
  });

  it("continues to the next row after one row fails", async () => {
    mockResumeSession
      .mockImplementationOnce(() => { throw new Error("gone"); })
      .mockReturnValueOnce(undefined as any);
    mockEngineer.mockResolvedValue(makeSuccessResult());
    mockSeniorEngineer.mockResolvedValue(makeSuccessResult());
    const state = makeState([
      makeInterruptedRow({ issueKey: "CREW-63-001", sessionId: "sess_gone" }),
      makeInterruptedRow({ issueKey: "CREW-63-002", sessionId: "sess_ok" }),
    ]);

    await recoverInterruptedSteps(state);

    expect(mockLogWarn).toHaveBeenCalledWith(
      "recovery.session-failed",
      expect.objectContaining({ issueKey: "CREW-63-001" }),
    );
    expect(mockLogInfo).toHaveBeenCalledWith(
      "recovery.session-resumed",
      expect.objectContaining({ issueKey: "CREW-63-002" }),
    );
  });
});
