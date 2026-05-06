import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SDKSession } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@daddia/crew";
import type { AgentInput } from "@daddia/crew";

vi.mock("@daddia/crew", () => ({
  resolveSession: vi.fn(),
  readPromptFile: vi.fn().mockResolvedValue("You are a senior-engineer persona."),
  readSkillsDir: vi.fn().mockResolvedValue([]),
  readSubagentsDir: vi.fn().mockResolvedValue([]),
  buildAuditHook: vi.fn().mockReturnValue(() => {}),
}));

import {
  resolveSession,
  readPromptFile,
  buildAuditHook,
} from "@daddia/crew";
import { seniorEngineer, parseReviewResult } from "../src/agents/senior-engineer/agent.js";

const mockResolveSession = vi.mocked(resolveSession);
const mockReadPromptFile = vi.mocked(readPromptFile);
const mockBuildAuditHook = vi.mocked(buildAuditHook);

const APPROVED_JSON = JSON.stringify({
  success: true,
  summary: "No blocking issues.",
  artefacts: { verdict: "approved", comments: [] },
  costUsd: 0,
});

function makeResultMessage(
  overrides: Partial<SDKResultMessage> = {},
): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 800,
    duration_api_ms: 600,
    is_error: false,
    num_turns: 2,
    result: APPROVED_JSON,
    stop_reason: "end_turn",
    total_cost_usd: 0.03,
    usage: {
      input_tokens: 80,
      output_tokens: 150,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: "test-uuid-se-1" as never,
    session_id: "sess-se-123",
    ...overrides,
  } as SDKResultMessage;
}

function makeSession(messages: SDKResultMessage[] = []): SDKSession {
  return {
    sessionId: "sess-se-123",
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
  issueKey: "CREW-50-003",
  context: { task: "peer-code-review", mrUrl: "https://gitlab.example.com/mr/7" },
};

describe("seniorEngineer.run()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AgentResult with success true when SDK session completes with approved verdict", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(true);
    expect(result.summary).toBe(APPROVED_JSON);
    expect(result.costUsd).toBe(0.03);
    expect(result.artefacts).toMatchObject({ sessionId: "sess-se-123", comments: [] });
  });

  it("returns AgentResult with success false when SDK session returns an error result", async () => {
    const session = makeSession([
      makeResultMessage({
        subtype: "error_during_execution",
        is_error: true,
        errors: ["Context window exceeded"],
        total_cost_usd: 0.02,
      } as Partial<SDKResultMessage>),
    ]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Context window exceeded");
  });

  it("returns AgentResult with success false when SDK throws", async () => {
    const session = makeSession();
    (session.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Connection refused"),
    );
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Connection refused");
  });

  it("calls buildAuditHook() once before SDK execution", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

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
      sessionId: "sess-se-123",
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    expect(mockResolveSession).toHaveBeenCalledWith(
      expect.objectContaining({ auditHook: fakeHook }),
    );
  });

  it("sends the persona prompt in the session message", async () => {
    const session = makeSession([makeResultMessage()]);
    mockReadPromptFile.mockResolvedValue("SENIOR ENGINEER INSTRUCTIONS");
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    const sent = (session.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sent).toContain("SENIOR ENGINEER INSTRUCTIONS");
  });

  it("passes memory: 'project' in the AgentDefinition to resolveSession", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

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
      sessionId: "sess-se-123",
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    expect(mockReadPromptFile).toHaveBeenCalledOnce();
  });

  it("disposes the session after run completes", async () => {
    const session = makeSession([makeResultMessage()]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    expect(session[Symbol.asyncDispose]).toHaveBeenCalledOnce();
  });

  it("disposes the session even when SDK throws", async () => {
    const session = makeSession();
    (session.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Unexpected failure"),
    );
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    await seniorEngineer.run(baseInput);

    expect(session[Symbol.asyncDispose]).toHaveBeenCalledOnce();
  });

  // ── Artefact extraction acceptance scenarios (CREW-66-002) ─────────────────

  it("Gherkin: approval result sets success true and comments to empty array (envelope format)", async () => {
    const approvedJson = JSON.stringify({
      success: true,
      summary: "No blocking issues.",
      artefacts: { verdict: "approved", comments: [] },
      costUsd: 0,
    });
    const session = makeSession([makeResultMessage({ result: approvedJson })]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(true);
    expect(result.artefacts["comments"]).toEqual([]);
    expect(result.artefacts["sessionId"]).toBe("sess-se-123");
  });

  it("Gherkin: changes-requested with structured findings sets success false and flattens comments (envelope format)", async () => {
    const changesJson = JSON.stringify({
      success: false,
      summary: "Two blockers found.",
      artefacts: {
        verdict: "changes-requested",
        comments: [
          {
            path: "src/foo.ts",
            line: 42,
            category: "blocker",
            observed: "null dereference",
            remediation: "add null check",
          },
          {
            path: "src/bar.ts",
            line: "L10",
            category: "warning",
            observed: "missing test",
            remediation: "add unit test",
          },
        ],
      },
      costUsd: 0,
    });
    const session = makeSession([makeResultMessage({ result: changesJson })]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    const comments = result.artefacts["comments"] as string[];
    expect(comments).toHaveLength(2);
    expect(comments[0]).toBe("src/foo.ts:42 [blocker] null dereference — add null check");
    expect(comments[1]).toBe("src/bar.ts:L10 [warning] missing test — add unit test");
    expect(result.artefacts["sessionId"]).toBe("sess-se-123");
  });

  it("Gherkin: changes-requested preserves pre-formatted string comments (envelope format)", async () => {
    const changesJson = JSON.stringify({
      success: false,
      summary: "One blocker.",
      artefacts: {
        verdict: "changes-requested",
        comments: ["src/auth.ts:L5 [blocker] path traversal — validate input"],
      },
      costUsd: 0,
    });
    const session = makeSession([makeResultMessage({ result: changesJson })]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.artefacts["comments"]).toEqual([
      "src/auth.ts:L5 [blocker] path traversal — validate input",
    ]);
  });

  it("Gherkin: unparsable result downgrades to success false and names the parse failure", async () => {
    const raw = "not json at all";
    const session = makeSession([makeResultMessage({ result: raw })]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("JSON parse failure");
    expect(result.summary).toContain("not json at all");
    expect(result.artefacts["sessionId"]).toBe("sess-se-123");
  });

  it("truncates the raw result to 500 characters in the summary on parse failure", async () => {
    const longRaw = "x".repeat(1000);
    const session = makeSession([makeResultMessage({ result: longRaw })]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(false);
    const excerptInSummary = "x".repeat(500);
    expect(result.summary).toContain(excerptInSummary);
    expect(result.summary).not.toContain("x".repeat(501));
  });

  it("forces comments to empty array on approved verdict even if model populates comments (envelope format)", async () => {
    const approvedJson = JSON.stringify({
      success: true,
      summary: "Approved with suggestion.",
      artefacts: {
        verdict: "approved",
        comments: [{ path: "src/a.ts", line: 1, category: "suggestion", observed: "minor", remediation: "fix" }],
      },
      costUsd: 0,
    });
    const session = makeSession([makeResultMessage({ result: approvedJson })]);
    mockResolveSession.mockResolvedValue({
      session,
      sessionId: "sess-se-123",
      isResumed: false,
    });

    const result = await seniorEngineer.run(baseInput);

    expect(result.success).toBe(true);
    expect(result.artefacts["comments"]).toEqual([]);
  });
});

describe("parseReviewResult()", () => {
  it("unwraps the AgentResult envelope and returns verdict and comments", () => {
    const raw = JSON.stringify({
      success: true,
      summary: "No blocking issues.",
      artefacts: { verdict: "approved", comments: [] },
      costUsd: 0,
    });
    const { verdict, comments } = parseReviewResult(raw);
    expect(verdict).toBe("approved");
    expect(comments).toEqual([]);
  });

  it("unwraps changes-requested envelope and flattens structured comments", () => {
    const raw = JSON.stringify({
      success: false,
      summary: "One blocker.",
      artefacts: {
        verdict: "changes-requested",
        comments: [
          { path: "src/x.ts", line: 7, category: "blocker", observed: "issue", remediation: "fix it" },
        ],
      },
      costUsd: 0,
    });
    const { verdict, comments } = parseReviewResult(raw);
    expect(verdict).toBe("changes-requested");
    expect(comments).toEqual(["src/x.ts:7 [blocker] issue — fix it"]);
  });

  it("parses an approved result with no comments (flat, no envelope)", () => {
    const raw = JSON.stringify({ verdict: "approved", comments: [] });
    const { verdict, comments } = parseReviewResult(raw);
    expect(verdict).toBe("approved");
    expect(comments).toEqual([]);
  });

  it("parses a changes-requested result and flattens structured comments (flat, no envelope)", () => {
    const raw = JSON.stringify({
      verdict: "changes-requested",
      comments: [
        { path: "src/x.ts", line: 7, category: "blocker", observed: "issue", remediation: "fix it" },
      ],
    });
    const { verdict, comments } = parseReviewResult(raw);
    expect(verdict).toBe("changes-requested");
    expect(comments).toEqual(["src/x.ts:7 [blocker] issue — fix it"]);
  });

  it("passes through pre-formatted string comments unchanged", () => {
    const raw = JSON.stringify({
      verdict: "changes-requested",
      comments: ["src/x.ts:7 [blocker] issue — fix it"],
    });
    const { comments } = parseReviewResult(raw);
    expect(comments).toEqual(["src/x.ts:7 [blocker] issue — fix it"]);
  });

  it("throws on non-JSON input", () => {
    expect(() => parseReviewResult("not json")).toThrow("JSON parse failure");
  });

  it("throws when verdict is missing or invalid", () => {
    expect(() => parseReviewResult(JSON.stringify({ verdict: "unknown", comments: [] }))).toThrow(
      "Unexpected verdict value",
    );
  });

  it("throws when comments field is not an array", () => {
    expect(() => parseReviewResult(JSON.stringify({ verdict: "approved", comments: "nope" }))).toThrow(
      "comments field is not an array",
    );
  });

  it("throws when the JSON is a non-object value", () => {
    expect(() => parseReviewResult(JSON.stringify([1, 2, 3]))).toThrow("not a JSON object");
  });
});
