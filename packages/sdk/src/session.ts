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
}

export interface ActiveSession {
  sessionId: string;
  isResumed: boolean;
}

/**
 * Resolve whether to start a new Claude session or resume an existing one.
 * The policy is: resume only for the address-feedback persona loop where
 * continuity of MR context matters. All other tasks start fresh.
 */
export async function resolveSession(
  options: SessionOptions,
  previousSessionId?: string,
): Promise<ActiveSession> {
  const { resumeWithinMs } = options;

  if (previousSessionId && resumeWithinMs > 0) {
    return { sessionId: previousSessionId, isResumed: true };
  }

  // Placeholder: real implementation calls the Claude SDK to create a session
  // and returns the assigned session ID.
  const sessionId = crypto.randomUUID();
  return { sessionId, isResumed: false };
}
