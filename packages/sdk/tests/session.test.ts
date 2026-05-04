import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SDKSession } from "@anthropic-ai/claude-agent-sdk";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  unstable_v2_createSession: vi.fn(),
  unstable_v2_resumeSession: vi.fn(),
}));

import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
} from "@anthropic-ai/claude-agent-sdk";
import { resolveSession } from "../src/session.js";
import type { SessionOptions } from "../src/session.js";

const mockCreate = vi.mocked(unstable_v2_createSession);
const mockResume = vi.mocked(unstable_v2_resumeSession);

function makeSession(sessionId: string): SDKSession {
  return {
    sessionId,
    send: vi.fn(),
    stream: vi.fn(),
    close: vi.fn(),
    [Symbol.asyncDispose]: vi.fn(),
  };
}

function makeOptions(overrides: Partial<SessionOptions> = {}): SessionOptions {
  return {
    definition: {
      name: "engineer",
      promptPath: "/fake/prompt.md",
      skillPaths: [],
      subagentPaths: [],
      allowedTools: ["Read", "Edit"],
      mcpServerNames: ["atlassian", "gitlab"],
    },
    input: { issueKey: "CREW-50-001", context: {} },
    resumeWithinMs: 60_000,
    model: "claude-test",
    ...overrides,
  };
}

describe("resolveSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create path", () => {
    it("calls unstable_v2_createSession when no previousSessionId is given", async () => {
      const fakeSession = makeSession("sdk-session-new");
      mockCreate.mockReturnValue(fakeSession);

      const result = await resolveSession(makeOptions());

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockCreate).toHaveBeenCalledWith({
        model: "claude-test",
        allowedTools: ["Read", "Edit"],
      });
      expect(mockResume).not.toHaveBeenCalled();
    });

    it("returns sessionId from the SDK session and isResumed false", async () => {
      const fakeSession = makeSession("sdk-session-abc");
      mockCreate.mockReturnValue(fakeSession);

      const result = await resolveSession(makeOptions());

      expect(result.sessionId).toBe("sdk-session-abc");
      expect(result.isResumed).toBe(false);
      expect(result.session).toBe(fakeSession);
    });

    it("creates a new session even when previousSessionId exists but resumeWithinMs is 0", async () => {
      const fakeSession = makeSession("sdk-session-fresh");
      mockCreate.mockReturnValue(fakeSession);

      const result = await resolveSession(
        makeOptions({ resumeWithinMs: 0 }),
        "old-session-id",
      );

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockResume).not.toHaveBeenCalled();
      expect(result.isResumed).toBe(false);
    });
  });

  describe("resume path", () => {
    it("calls unstable_v2_resumeSession when a previousSessionId exists", async () => {
      const fakeSession = makeSession("sess_abc");
      mockResume.mockReturnValue(fakeSession);

      await resolveSession(makeOptions(), "sess_abc");

      expect(mockResume).toHaveBeenCalledOnce();
      expect(mockResume).toHaveBeenCalledWith("sess_abc", {
        model: "claude-test",
        allowedTools: ["Read", "Edit"],
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns the previousSessionId and isResumed true", async () => {
      const fakeSession = makeSession("sess_abc");
      mockResume.mockReturnValue(fakeSession);

      const result = await resolveSession(makeOptions(), "sess_abc");

      expect(result.sessionId).toBe("sess_abc");
      expect(result.isResumed).toBe(true);
      expect(result.session).toBe(fakeSession);
    });
  });

  describe("error propagation", () => {
    it("re-throws SDK errors on the create path and does not return a random UUID", async () => {
      const sdkError = new Error("Network error during session creation");
      mockCreate.mockImplementation(() => {
        throw sdkError;
      });

      await expect(resolveSession(makeOptions())).rejects.toThrow(
        "Network error during session creation",
      );
    });

    it("re-throws SDK errors on the resume path", async () => {
      const sdkError = new Error("Session not found");
      mockResume.mockImplementation(() => {
        throw sdkError;
      });

      await expect(
        resolveSession(makeOptions(), "missing-session"),
      ).rejects.toThrow("Session not found");
    });
  });
});
