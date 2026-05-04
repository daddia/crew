import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition, AgentInput } from "@daddia/contracts";

export interface SessionOptions {
  definition: AgentDefinition;
  input: AgentInput;
  /**
   * If a session for (persona, issueKey) was started within this many
   * milliseconds, resume it. Otherwise start fresh.
   * Set to 0 to always start fresh.
   */
  resumeWithinMs: number;
  /**
   * Model identifier passed to the Claude Agent SDK.
   * e.g. "claude-opus-4-5", "claude-sonnet-4-6"
   */
  model: string;
}

export interface ActiveSession {
  sessionId: string;
  isResumed: boolean;
  /**
   * The live SDK session handle. Callers use this to send messages and
   * stream responses. Must be disposed when the run completes.
   */
  session: SDKSession;
}

/**
 * Resolve whether to start a new Claude session or resume an existing one.
 * Calls unstable_v2_createSession when no prior sessionId exists, and
 * unstable_v2_resumeSession when one does. Errors from the SDK are
 * propagated directly to the caller.
 */
export async function resolveSession(
  options: SessionOptions,
  previousSessionId?: string,
): Promise<ActiveSession> {
  const { resumeWithinMs, model, definition } = options;

  const sdkOptions = {
    model,
    allowedTools: definition.allowedTools,
  };

  if (previousSessionId && resumeWithinMs > 0) {
    const session = unstable_v2_resumeSession(previousSessionId, sdkOptions);
    return { sessionId: previousSessionId, isResumed: true, session };
  }

  const session = unstable_v2_createSession(sdkOptions);
  return { sessionId: session.sessionId, isResumed: false, session };
}
