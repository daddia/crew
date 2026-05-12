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

import { runStory } from "../src/workflow.js";
import type { WorkflowCtxBase } from "../src/workflow.js";
import { log } from "../src/observability.js";
import { engineer } from "../src/agents/engineer/agent.js";
import { seniorEngineer } from "../src/agents/senior-engineer/agent.js";
import type { StateStore } from "../src/state.js";
import type { JiraClient } from "../src/integrations/jira.js";
import type { GitlabClient } from "../src/integrations/gitlab.js";

const mockEngineer = vi.mocked(engineer.run);
const mockSeniorEngineer = vi.mocked(seniorEngineer.run);
const mockLogInfo = vi.mocked(log.info);

function makeJiraMock(): JiraClient {
  return {
    transitionIssue: vi.fn().mockResolvedValue(undefined),
    commentOnIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn().mockResolvedValue({
      summary: "Test Story",
      description: "Do the work.",
      acceptanceCriteria: null,
    }),
    searchIssues: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
  };
}

function makeGitlabMock(): GitlabClient {
  return {
    createMr: vi.fn().mockResolvedValue("https://gitlab.example.com/mr/1"),
    getMrDiff: vi.fn().mockResolvedValue("--- file.ts\n+line"),
    postReviewComment: vi.fn().mockResolvedValue(undefined),
    getPipelineStatus: vi.fn().mockResolvedValue("success"),
  };
}

function makeCtxBase(behaviourOverrides: Partial<WorkflowCtxBase["behaviour"]> = {}): WorkflowCtxBase & {
  jira: ReturnType<typeof makeJiraMock>;
  gitlab: ReturnType<typeof makeGitlabMock>;
} {
  const jira = makeJiraMock();
  const gitlab = makeGitlabMock();
  return {
    behaviour: {
      refactorLoopCap: 2,
      ciRetryCap: 3,
      ciPollIntervalMs: 0,
      ...behaviourOverrides,
    },
    jira,
    gitlab,
    projectDir: "/project",
  };
}

function makeState(refactorCount = 0): StateStore {
  return {
    upsertStory: vi.fn(),
    getStory: vi.fn(),
    getStoriesAtStep: vi.fn().mockReturnValue([]),
    startStep: vi.fn(),
    finishStep: vi.fn(),
    getStepHistory: vi.fn().mockReturnValue([]),
    countRefactorIterations: vi.fn().mockReturnValue(refactorCount),
    getInterruptedSteps: vi.fn().mockReturnValue([]),
    ping: vi.fn(),
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
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const engineerOrder = mockEngineer.mock.invocationCallOrder[0] as number;
    const reviewOrder = mockSeniorEngineer.mock.invocationCallOrder[0] as number;
    const createMrOrder = vi.mocked(ctxBase.gitlab.createMr).mock.invocationCallOrder[0] as number;

    expect(engineerOrder).toBeLessThan(reviewOrder);
    expect(reviewOrder).toBeLessThan(createMrOrder);

    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "In QA");
    expect(ctxBase.jira.transitionIssue).not.toHaveBeenCalledWith("ENG-1", "In Review");
  });

  it("calls createMr() once after seniorEngineer returns success", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(ctxBase.gitlab.createMr).toHaveBeenCalledTimes(1);
  });

  it("records verdict 'failed' on implement step when engineer returns no branchName", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult({ artefacts: { title: "Test" } }));

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const finishCall = vi.mocked(state.finishStep).mock.calls.find((c) => c[1] === "implement");
    expect(finishCall).toBeDefined();
    expect(finishCall![2]).toMatchObject({ verdict: "failed" });
    expect(ctxBase.jira.commentOnIssue).toHaveBeenCalledWith("ENG-1", expect.stringContaining("Escalated"));
  });

  it("escalates to human review when engineer fails to implement", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult({ success: false }));

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(mockSeniorEngineer).not.toHaveBeenCalled();
    expect(ctxBase.gitlab.createMr).not.toHaveBeenCalled();
    expect(ctxBase.jira.commentOnIssue).toHaveBeenCalledWith("ENG-1", expect.stringContaining("Escalated"));
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "Needs human review");
  });

  it("does not open MR when loop cap is exceeded", async () => {
    const ctxBase = makeCtxBase({ refactorLoopCap: 2 });
    const reviewFailResult = successResult({
      success: false,
      artefacts: { branchName: "feature/ENG-1-test", comments: ["fix the thing"] },
    });
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(reviewFailResult);

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    // With refactorLoopCap=2: initial review + 2 address+review cycles = 3 total
    expect(mockSeniorEngineer.mock.calls.length).toBe(3);
    expect(ctxBase.gitlab.createMr).not.toHaveBeenCalled();
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "Needs human review");
  });

  it("opens MR and hands off when peer review passes on second iteration", async () => {
    const ctxBase = makeCtxBase();
    let reviewCall = 0;
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockImplementation(async (_input: AgentInput) => {
      reviewCall++;
      return successResult({ success: reviewCall > 1 });
    });

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    // Engineer called once for assess-clarification, once for implement, once for address-feedback
    expect(mockEngineer).toHaveBeenCalledTimes(3);
    expect(mockSeniorEngineer).toHaveBeenCalledTimes(2);
    expect(ctxBase.gitlab.createMr).toHaveBeenCalledTimes(1);
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "In QA");
  });

  it("passes branchName (not mrUrl) to senior engineer during peer review", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(mockSeniorEngineer).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ task: "peer-code-review", branchName: "feature/ENG-1-test" }),
      }),
    );
  });

  it("calls getIssue before engineer.run() for the implement task", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(ctxBase.jira.getIssue).toHaveBeenCalledWith("ENG-1");
    expect(vi.mocked(ctxBase.jira.getIssue).mock.invocationCallOrder[0]).toBeLessThan(
      mockEngineer.mock.invocationCallOrder[0] as number,
    );
  });

  it("passes context.ticket to engineer for the implement task", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

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
    const ctxBase = makeCtxBase();
    vi.mocked(ctxBase.jira.getIssue).mockRejectedValueOnce(new Error("network error"));
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const implementCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "implement-story",
    );
    expect(implementCall).toBeDefined();
    expect((implementCall![0] as AgentInput).context["ticket"]).toBeNull();
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
      "workflow.context-seed.failed",
      expect.objectContaining({ issueKey: "ENG-1" }),
    );
  });

  it("passes branchName to engineer during address-feedback", async () => {
    const ctxBase = makeCtxBase();
    let reviewCall = 0;
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockImplementation(async (_input: AgentInput) => {
      reviewCall++;
      return successResult({ success: reviewCall > 1, artefacts: { branchName: "feature/ENG-1-test", comments: ["fix x"] } });
    });

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const feedbackCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "address-feedback",
    );
    expect(feedbackCall).toBeDefined();
    expect((feedbackCall![0] as AgentInput).context["branchName"]).toBe("feature/ENG-1-test");
  });

  // ── CI monitoring loop ───────────────────────────────────────────────────

  it("polls pipeline after MR opens and proceeds when CI is green", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(ctxBase.gitlab.getPipelineStatus).toHaveBeenCalledWith("https://gitlab.example.com/mr/1");
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "In QA");
  });

  it("calls engineer with task fix-ci on pipeline failure then proceeds on success", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());
    vi.mocked(ctxBase.gitlab.getPipelineStatus)
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("success");

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const ciFixCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "fix-ci",
    );
    expect(ciFixCall).toBeDefined();
    expect((ciFixCall![0] as AgentInput).context["mrUrl"]).toBe("https://gitlab.example.com/mr/1");
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "In QA");
  });

  it("escalates when CI fix cap is exceeded without success", async () => {
    const ctxBase = makeCtxBase({ ciRetryCap: 2 });
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());
    vi.mocked(ctxBase.gitlab.getPipelineStatus).mockResolvedValue("failed");

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const ciFixCalls = mockEngineer.mock.calls.filter(
      (call) => (call[0] as AgentInput).context["task"] === "fix-ci",
    );
    expect(ciFixCalls).toHaveLength(2);
    expect(ctxBase.jira.commentOnIssue).toHaveBeenCalledWith("ENG-1", expect.stringContaining("Escalated"));
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "Needs human review");
    expect(ctxBase.jira.transitionIssue).not.toHaveBeenCalledWith("ENG-1", "In Review");
  });

  it("re-polls pipeline when status is running before checking again", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());
    vi.mocked(ctxBase.gitlab.getPipelineStatus)
      .mockResolvedValueOnce("running")
      .mockResolvedValueOnce("success");

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(ctxBase.gitlab.getPipelineStatus).toHaveBeenCalledTimes(2);
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "In QA");
  });

  it("passes context.ticket to engineer for the address-feedback task", async () => {
    const ctxBase = makeCtxBase();
    let reviewCall = 0;
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockImplementation(async (_input: AgentInput) => {
      reviewCall++;
      return successResult({ success: reviewCall > 1, artefacts: { branchName: "feature/ENG-1-test", comments: ["fix x"] } });
    });

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const feedbackCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "address-feedback",
    );
    expect(feedbackCall).toBeDefined();
    expect((feedbackCall![0] as AgentInput).context["ticket"]).toMatchObject({ summary: "Test Story" });
  });

  // ── In QA handoff ─────────────────────────────────────────────────────────

  it("emits workflow.handoff-to-qa log after transitioning to In QA", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(mockLogInfo).toHaveBeenCalledWith(
      "workflow.handoff-to-qa",
      expect.objectContaining({ issueKey: "ENG-1", mrUrl: "https://gitlab.example.com/mr/1" }),
    );
  });

  // ── sessionId wiring ──────────────────────────────────────────────────────

  it("passes sessionId from engineer.run() result to state.startStep() for the implement step", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(
      successResult({ artefacts: { branchName: "feature/ENG-1-test", title: "Test", sessionId: "sess_abc" } }),
    );
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(vi.mocked(state.startStep)).toHaveBeenCalledWith("ENG-1", "implement", "sess_abc");
  });

  it("passes sessionId from engineer.run() result to state.startStep() for the address-feedback step", async () => {
    const ctxBase = makeCtxBase();
    let reviewCall = 0;
    mockEngineer
      .mockResolvedValueOnce(successResult()) // assess-clarification
      .mockResolvedValueOnce(successResult({ artefacts: { branchName: "feature/ENG-1-test", title: "Test", sessionId: "sess_impl" } }))
      .mockResolvedValueOnce(successResult({ artefacts: { branchName: "feature/ENG-1-test", title: "Test", sessionId: "sess_def" } }));
    mockSeniorEngineer.mockImplementation(async (_input: AgentInput) => {
      reviewCall++;
      return successResult({ success: reviewCall > 1 });
    });

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(vi.mocked(state.startStep)).toHaveBeenCalledWith("ENG-1", "address-feedback", "sess_def");
  });

  it("does not pass sessionId to state.startStep() for non-agent steps", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const startStepMock = vi.mocked(state.startStep);
    const openMrCall = startStepMock.mock.calls.find((c) => c[1] === "open-mr");
    const reviewCall = startStepMock.mock.calls.find((c) => c[1] === "peer-code-review");

    expect(openMrCall).toBeDefined();
    expect(openMrCall![2]).toBeUndefined();
    expect(reviewCall).toBeDefined();
    expect(reviewCall![2]).toBeUndefined();
  });

  it("never transitions to In Review in the normal workflow path", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(ctxBase.jira.transitionIssue).not.toHaveBeenCalledWith("ENG-1", "In Review");
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "In QA");
  });

  // ── Clarification assessment ─────────────────────────────────────────────

  it("calls engineer with task assess-clarification before transitioning to In Progress", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const assessCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "assess-clarification",
    );
    expect(assessCall).toBeDefined();

    const assessOrder = mockEngineer.mock.invocationCallOrder[
      mockEngineer.mock.calls.indexOf(assessCall!)
    ] as number;
    const transitionMock = vi.mocked(ctxBase.jira.transitionIssue);
    const inProgressOrder = transitionMock.mock.invocationCallOrder[
      transitionMock.mock.calls.findIndex((c) => c[1] === "In Progress")
    ] as number;

    expect(assessOrder).toBeLessThan(inProgressOrder);
  });

  it("passes context.ticket to engineer for the assess-clarification task", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult());
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const assessCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "assess-clarification",
    );
    expect(assessCall).toBeDefined();
    expect((assessCall![0] as AgentInput).context["ticket"]).toMatchObject({
      summary: "Test Story",
      description: "Do the work.",
    });
  });

  it("proceeds to In Progress when engineer returns questionsRequired: false", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(
      successResult({ artefacts: { questionsRequired: false, branchName: "feature/ENG-1-test", title: "Test" } }),
    );
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(ctxBase.jira.commentOnIssue).not.toHaveBeenCalled();
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "In Progress");
  });

  it("posts questions and transitions to Clarification Needed when questionsRequired: true", async () => {
    const ctxBase = makeCtxBase();
    const questions = "What is the expected error behaviour?";
    mockEngineer.mockResolvedValueOnce(
      successResult({ artefacts: { questionsRequired: true, questions } }),
    );

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(ctxBase.jira.commentOnIssue).toHaveBeenCalledWith("ENG-1", questions);
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "Clarification Needed");
    expect(ctxBase.jira.transitionIssue).not.toHaveBeenCalledWith("ENG-1", "In Progress");
  });

  it("records clarification-pending step in state store when questions are required", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValueOnce(
      successResult({ artefacts: { questionsRequired: true, questions: "Is this right?" } }),
    );

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(vi.mocked(state.upsertStory)).toHaveBeenCalledWith("ENG-1", "clarification-pending");
    expect(vi.mocked(state.startStep)).toHaveBeenCalledWith("ENG-1", "clarification-pending");
    const finishCall = vi.mocked(state.finishStep).mock.calls.find((c) => c[1] === "clarification-pending");
    expect(finishCall).toBeDefined();
    expect(finishCall![2]).toMatchObject({ verdict: "pending" });
  });

  it("records startStep and finishStep for assess-clarification when ticket is clear", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValue(successResult({ costUsd: 0.05, artefacts: { questionsRequired: false, branchName: "feature/ENG-1-test", title: "Test" } }));
    mockSeniorEngineer.mockResolvedValue(successResult());

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(vi.mocked(state.startStep)).toHaveBeenCalledWith("ENG-1", "assess-clarification", undefined);
    const finishCall = vi.mocked(state.finishStep).mock.calls.find((c) => c[1] === "assess-clarification");
    expect(finishCall).toBeDefined();
    expect(finishCall![2]).toMatchObject({ costUsd: 0.05, verdict: "ok" });
  });

  it("escalates to human review and returns early when assess-clarification returns success: false", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValueOnce(successResult({ success: false, artefacts: {} }));

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    expect(ctxBase.jira.transitionIssue).not.toHaveBeenCalledWith("ENG-1", "In Progress");
    expect(ctxBase.jira.transitionIssue).toHaveBeenCalledWith("ENG-1", "Needs human review");

    const implementCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "implement-story",
    );
    expect(implementCall).toBeUndefined();

    const finishCall = vi.mocked(state.finishStep).mock.calls.find((c) => c[1] === "assess-clarification");
    expect(finishCall).toBeDefined();
    expect(finishCall![2]).toMatchObject({ verdict: "failed" });
  });

  it("does not call engineer for implement when clarification is needed", async () => {
    const ctxBase = makeCtxBase();
    mockEngineer.mockResolvedValueOnce(
      successResult({ artefacts: { questionsRequired: true, questions: "Clarify scope." } }),
    );

    const state = makeState();
    await runStory({ issueKey: "ENG-1", state, ...ctxBase });

    const implementCall = mockEngineer.mock.calls.find(
      (call) => (call[0] as AgentInput).context["task"] === "implement-story",
    );
    expect(implementCall).toBeUndefined();
  });
});
