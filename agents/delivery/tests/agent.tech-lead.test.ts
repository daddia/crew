import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SDKSession } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@daddia/crew";
import type { AgentInput } from "@daddia/crew";

vi.mock("@daddia/crew", () => ({
  resolveSession: vi.fn(),
  readPromptFile: vi.fn().mockResolvedValue("You are a tech-lead persona."),
  readSkillsDir: vi.fn().mockResolvedValue([]),
  readSubagentsDir: vi.fn().mockResolvedValue([]),
  buildAuditHook: vi.fn().mockReturnValue(() => {}),
}));

import {
  resolveSession,
  readPromptFile,
  buildAuditHook,
} from "@daddia/crew";
import { techLead } from "../src/agents/tech-lead/agent.js";

const mockResolveSession = vi.mocked(resolveSession);
const mockReadPromptFile = vi.mocked(readPromptFile);
const mockBuildAuditHook = vi.mocked(buildAuditHook);

function makeResultMessage(
  overrides: Partial<SDKResultMessage> = {},
): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 900,
    duration_api_ms: 700,
    is_error: false,
    num_turns: 2,
    result: "Final code review passed. Architecture is sound.",
    stop_reason: "end_turn",
    total_cost_usd: 0.04,
    usage: {
      input_tokens: 90,
      output_tokens: 160,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: "test-uuid-tl-1" as never,
    session_id: "sess-tl-123",
    ...overrides,
  } as SDKResultMessage;
}

function makeSession(messages: SDKResultMessage[] = []): SDKSession {
  return {
    sessionId: "sess-tl-123",
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
  issueKey: "CREW-50-004",
  context: { task: "final-code-review", mrUrl: "https://gitlab.example.com/mr/9" },
};

describe("techLead.run()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AgentResult with success true when SDK session completes", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-tl-123",
      isResumed: false,
    });

    const result = await techLead.run(baseInput);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Final code review passed. Architecture is sound.");
    expect(result.costUsd).toBe(0.04);
    expect(result.artefacts).toMatchObject({ sessionId: "sess-tl-123" });
  });

  it("returns AgentResult with success false when SDK session returns an error result", async () => {
    const session = makeSession([
      makeResultMessage({
        subtype: "error_during_execution",
        is_error: true,
        errors: ["Max turns exceeded"],
        total_cost_usd: 0.02,
      } as Partial<SDKResultMessage>),
    ]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-tl-123",
      isResumed: false,
    });

    const result = await techLead.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Max turns exceeded");
  });

  it("returns AgentResult with success false when SDK throws", async () => {
    const session = makeSession();
    (session.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Authentication failed"),
    );
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-tl-123",
      isResumed: false,
    });

    const result = await techLead.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Authentication failed");
  });

  it("calls buildAuditHook() once before SDK execution", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-tl-123",
      isResumed: false,
    });

    await techLead.run(baseInput);

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
      sessionId: "sess-tl-123",
      isResumed: false,
    });

    await techLead.run(baseInput);

    expect(mockResolveSession).toHaveBeenCalledWith(
      expect.objectContaining({ auditHook: fakeHook }),
    );
  });

  it("sends the persona prompt in the session message", async () => {
    const session = makeSession([makeResultMessage()]);
    mockReadPromptFile.mockResolvedValue("TECH LEAD INSTRUCTIONS");
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-tl-123",
      isResumed: false,
    });

    await techLead.run(baseInput);

    const sent = (session.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sent).toContain("TECH LEAD INSTRUCTIONS");
  });

  it("passes memory: 'project' in the AgentDefinition to resolveSession", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-tl-123",
      isResumed: false,
    });

    await techLead.run(baseInput);

    expect(mockResolveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({ memory: "project" }),
      }),
    );
  });

  it("reads the prompt file from the definition", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-tl-123",
      isResumed: false,
    });

    await techLead.run(baseInput);

    expect(mockReadPromptFile).toHaveBeenCalledOnce();
  });

  it("disposes the session after run completes", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-tl-123",
      isResumed: false,
    });

    await techLead.run(baseInput);

    expect(session[Symbol.asyncDispose]).toHaveBeenCalledOnce();
  });

  it("disposes the session even when SDK throws", async () => {
    const session = makeSession();
    (session.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Unexpected failure"),
    );
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-tl-123",
      isResumed: false,
    });

    await techLead.run(baseInput);

    expect(session[Symbol.asyncDispose]).toHaveBeenCalledOnce();
  });
});
