import { access } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKSession,
  type SettingSource,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition, AgentInput } from './agent.js';
import { toSDKHookCallback, type PostToolUseHandler } from './hooks.js';

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
  /**
   * Optional audit hook returned by buildAuditHook(). When provided it is
   * adapted to the SDK's HookCallback shape and attached to the session's
   * PostToolUse event so disallowed tool calls are caught at runtime.
   */
  auditHook?: PostToolUseHandler;
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
 *
 * Subagent definitions listed in AgentDefinition.subagentPaths are validated
 * before the session is created. Missing files are skipped with a warning.
 * When valid subagent paths are present, the SDK subprocess is pointed at the
 * agent's project directory (settingSources: ['project']) so it loads the
 * .claude/agents/ definitions automatically.
 */
export async function resolveSession(
  options: SessionOptions,
  previousSessionId?: string,
): Promise<ActiveSession> {
  const { resumeWithinMs, model, definition, auditHook } = options;

  // Check all subagent files in parallel; warn and skip any that are absent.
  // The SDK subprocess loads the valid ones via settingSources: ['project'].
  const results = await Promise.all(
    definition.subagentPaths.map(async (p) => {
      try {
        await access(p);
        return p;
      } catch {
        console.warn(`resolveSession: subagent file not found, skipping: ${p}`);
        return null;
      }
    }),
  );
  const validSubagentPaths = results.filter((p): p is string => p !== null);

  // Set cwd to the agent's own directory so the SDK subprocess resolves
  // project-scoped agent configuration from the expected tree under that cwd.
  // Note: SDKSessionOptions.cwd was silently ignored in SDK <0.2.77 (issue
  // anthropics/claude-code#39731). Verify with a smoke test after upgrading.
  const cwd = dirname(definition.promptPath);
  const settingSources: SettingSource[] = validSubagentPaths.length > 0 ? ['project'] : [];

  const sdkOptions = {
    model,
    allowedTools: definition.allowedTools,
    cwd,
    ...(settingSources.length > 0 ? { settingSources } : {}),
    ...(auditHook
      ? {
          hooks: {
            PostToolUse: [{ hooks: [toSDKHookCallback(auditHook)] }],
          },
        }
      : {}),
  };

  if (previousSessionId && resumeWithinMs > 0) {
    const session = unstable_v2_resumeSession(previousSessionId, sdkOptions);
    return { sessionId: previousSessionId, isResumed: true, session };
  }

  const session = unstable_v2_createSession(sdkOptions);
  return { sessionId: session.sessionId, isResumed: false, session };
}
