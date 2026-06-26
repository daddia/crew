import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  query,
  type Options,
  type Query,
  type SDKMessage,
  type SettingSource,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition, AgentInput } from './agent.js';
import type { SubmitResultCapture } from './result.js';
import {
  buildToolAllowlistGuard,
  toSDKHookCallback,
  type PostToolUseHandler,
  type ToolDenialHandler,
} from './hooks.js';

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
   * PostToolUse event for audit logging after each tool completes.
   */
  auditHook?: PostToolUseHandler;
  /**
   * Called when the pre-execution allowlist guard denies a tool call.
   * Use this to record denials in the audit trail.
   */
  onToolDeny?: ToolDenialHandler;
  /**
   * In-process submit_result MCP server. When provided, the tool is added to
   * allowedTools and wired into mcpServers for deterministic result capture.
   */
  resultCapture?: SubmitResultCapture;
}

/**
 * Live handle for a single agent turn. Call {@link send} once, then iterate
 * {@link stream} until a result message arrives.
 */
export interface AgentSession {
  readonly sessionId: string;
  send(prompt: string): Promise<void>;
  stream(): AsyncIterable<SDKMessage>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface ActiveSession {
  sessionId: string;
  isResumed: boolean;
  session: AgentSession;
}

class QueryBackedSession implements AgentSession {
  readonly sessionId: string;
  private readonly isResumed: boolean;
  private readonly baseOptions: Options;
  private queryHandle: Query | null = null;

  constructor(sessionId: string, isResumed: boolean, baseOptions: Options) {
    this.sessionId = sessionId;
    this.isResumed = isResumed;
    this.baseOptions = baseOptions;
  }

  async send(prompt: string): Promise<void> {
    if (this.queryHandle) {
      throw new Error('AgentSession.send() must only be called once');
    }
    const options: Options = {
      ...this.baseOptions,
      ...(this.isResumed ? { resume: this.sessionId } : { sessionId: this.sessionId }),
    };
    this.queryHandle = query({ prompt, options });
  }

  stream(): AsyncIterable<SDKMessage> {
    if (!this.queryHandle) {
      throw new Error('AgentSession.stream() requires send() first');
    }
    return this.queryHandle;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.queryHandle?.close();
  }
}

async function filterExistingPaths(
  paths: string[],
  label: 'skill' | 'subagent',
): Promise<string[]> {
  const results = await Promise.all(
    paths.map(async (p) => {
      try {
        await access(p);
        return p;
      } catch {
        console.warn(`resolveSession: ${label} file not found, skipping: ${p}`);
        return null;
      }
    }),
  );
  return results.filter((p): p is string => p !== null);
}

/**
 * Resolve whether to start a new Claude session or resume an existing one.
 * Returns a session handle; call {@link AgentSession.send} then iterate
 * {@link AgentSession.stream}. Errors from the SDK are propagated on send or
 * while streaming.
 *
 * Skill and subagent paths listed on AgentDefinition are validated before the
 * session is created. Missing files are skipped with a warning. When at least
 * one valid skill or subagent path exists, the SDK subprocess is pointed at the
 * agent's project directory (settingSources: ['project']) so it loads
 * .claude/skills/ and .claude/agents/ definitions automatically.
 */
export async function resolveSession(
  options: SessionOptions,
  previousSessionId?: string,
): Promise<ActiveSession> {
  const { resumeWithinMs, model, definition, auditHook, onToolDeny, resultCapture } = options;

  const [validSkillPaths, validSubagentPaths] = await Promise.all([
    filterExistingPaths(definition.skillPaths, 'skill'),
    filterExistingPaths(definition.subagentPaths, 'subagent'),
  ]);

  const cwd = dirname(definition.promptPath);
  const settingSources: SettingSource[] =
    validSkillPaths.length > 0 || validSubagentPaths.length > 0 ? ['project'] : [];

  const allowedTools = resultCapture
    ? [...definition.allowedTools, resultCapture.toolName]
    : definition.allowedTools;

  const baseOptions: Options = {
    model,
    allowedTools,
    canUseTool: buildToolAllowlistGuard(allowedTools, onToolDeny),
    cwd,
    ...(settingSources.length > 0 ? { settingSources } : {}),
    ...(resultCapture ? { mcpServers: resultCapture.mcpServers } : {}),
    ...(auditHook
      ? {
          hooks: {
            PostToolUse: [{ hooks: [toSDKHookCallback(auditHook)] }],
          },
        }
      : {}),
  };

  const shouldResume = Boolean(previousSessionId && resumeWithinMs > 0);
  const sessionId = shouldResume ? previousSessionId! : randomUUID();

  return {
    sessionId,
    isResumed: shouldResume,
    session: new QueryBackedSession(sessionId, shouldResume, baseOptions),
  };
}
