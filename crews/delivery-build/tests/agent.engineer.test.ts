import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SDKSession } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@daddia/crew";
import type { AgentInput } from "@daddia/crew";

// Mock @daddia/crew before the module under test is imported.
vi.mock("@daddia/crew", () => ({
  resolveSession: vi.fn(),
  readPromptFile: vi.fn().mockResolvedValue("You are an engineer persona."),
  readSkillsDir: vi.fn().mockResolvedValue([]),
  readSubagentsDir: vi.fn().mockResolvedValue([]),
  buildAuditHook: vi.fn().mockReturnValue(() => {}),
}));

import {
  resolveSession,
  readPromptFile,
  buildAuditHook,
} from "@daddia/crew";
import { engineer } from "../src/agents/engineer/agent.js";

const mockResolveSession = vi.mocked(resolveSession);
const mockReadPromptFile = vi.mocked(readPromptFile);
const mockBuildAuditHook = vi.mocked(buildAuditHook);

function makeResultMessage(
  overrides: Partial<SDKResultMessage> = {},
): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: false,
    num_turns: 3,
    result: "Task completed successfully",
    stop_reason: "end_turn",
    total_cost_usd: 0.05,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: "test-uuid-1234" as never,
    session_id: "sess-test-123",
    ...overrides,
  } as SDKResultMessage;
}

function makeErrorMessage(): SDKResultMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    duration_ms: 500,
    duration_api_ms: 400,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 50,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    errors: ["Rate limit exceeded"],
    uuid: "test-uuid-5678" as never,
    session_id: "sess-test-123",
  } as SDKResultMessage;
}

function makeSession(messages: SDKResultMessage[] = []): SDKSession {
  return {
    sessionId: "sess-test-123",
    send: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockImplementation(async function* () {
      for (const msg of messages) {
        yield msg;
      }
    }),
    close: vi.fn(),
    [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
  };
}

const baseInput: AgentInput = {
  issueKey: "CREW-50-001",
  context: { task: "implement-story" },
};

describe("engineer.run()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AgentResult with success true when SDK session completes", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    const result = await engineer.run(baseInput);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Task completed successfully");
    expect(result.costUsd).toBe(0.05);
    expect(result.artefacts).toMatchObject({ sessionId: "sess-test-123" });
  });

  it("returns AgentResult with success false when SDK session returns an error result", async () => {
    const session = makeSession([makeErrorMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    const result = await engineer.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Rate limit exceeded");
    expect(result.costUsd).toBe(0.01);
  });

  it("returns AgentResult with success false when SDK throws", async () => {
    const session = makeSession();
    (session.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    const result = await engineer.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Network error");
  });

  it("calls resolveSession() before sending to the SDK", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    await engineer.run(baseInput);

    expect(mockResolveSession).toHaveBeenCalledOnce();
    expect(session.send).toHaveBeenCalledAfter(
      mockResolveSession as ReturnType<typeof vi.fn>,
    );
  });

  it("calls buildAuditHook() once before SDK execution", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    await engineer.run(baseInput);

    expect(mockBuildAuditHook).toHaveBeenCalledOnce();
    expect(mockBuildAuditHook).toHaveBeenCalledBefore(
      session.send as ReturnType<typeof vi.fn>,
    );
  });

  it("passes the audit hook to resolveSession as auditHook", async () => {
    const fakeHook = vi.fn();
    mockBuildAuditHook.mockReturnValue(fakeHook);
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    await engineer.run(baseInput);

    const callOptions = mockResolveSession.mock.calls[0]?.[0];
    expect(callOptions).toMatchObject({ auditHook: fakeHook });
  });

  it("sends the full persona prompt on a new session (not a continuation)", async () => {
    const session = makeSession([makeResultMessage()]);
    mockReadPromptFile.mockResolvedValue("PERSONA INSTRUCTIONS");
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    await engineer.run(baseInput);

    const sent = (session.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sent).toContain("PERSONA INSTRUCTIONS");
  });

  it("passes memory: 'project' in the AgentDefinition to resolveSession", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    await engineer.run(baseInput);

    const callOptions = mockResolveSession.mock.calls[0]?.[0];
    expect(callOptions).toMatchObject({
      definition: expect.objectContaining({ memory: "project" }),
    });
  });

  it("reads the prompt file from the definition", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    await engineer.run(baseInput);

    expect(mockReadPromptFile).toHaveBeenCalledOnce();
  });

  it("disposes the session after run completes", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    await engineer.run(baseInput);

    expect(session[Symbol.asyncDispose]).toHaveBeenCalledOnce();
  });

  it("disposes the session even when SDK throws", async () => {
    const session = makeSession();
    (session.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Unexpected failure"),
    );
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-test-123",
      isResumed: false,
    });

    await engineer.run(baseInput);

    expect(session[Symbol.asyncDispose]).toHaveBeenCalledOnce();
  });
});
