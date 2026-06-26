import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  query,
  type Options,
  type Query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition, AgentInput } from './agent.js';
import type { SubmitResultCapture } from './result.js';
import {
  buildToolAllowlistGuard,
  toSDKHookCallback,
  toSDKSubagentAuditCallback,
  type PostToolUseHandler,
  type SubagentAuditHandler,
  type ToolDenialHandler,
} from './hooks.js';
import type { SdkSubagentDefinition } from './subagents.js';
import { resolvePluginBundles } from './plugins.js';

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
  /**
   * Working tree directory for Read/Edit/Write/Bash. When omitted, cwd is the
   * persona directory (`dirname(promptPath)`).
   */
  workspaceCwd?: string;
  /** SDK turn ceiling — session terminates when exceeded. */
  maxTurns?: number;
  /** SDK per-run USD budget — session terminates when exceeded. */
  maxBudgetUsd?: number;
  /** Inline subagent definitions for the Task tool. */
  sdkAgents?: Record<string, SdkSubagentDefinition>;
  /** Namespaced skill names to enable (defaults from plugin bundles). */
  skills?: string[];
  /** Audit callback for SubagentStart/SubagentStop events. */
  onSubagentAudit?: SubagentAuditHandler;
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
 * session is created. Missing files are skipped with a warning. Skills,
 * subagents, hooks, and MCP servers load via explicit SDK `plugins` bundles —
 * not filesystem setting-source heuristics.
 */
export async function resolveSession(
  options: SessionOptions,
  previousSessionId?: string,
): Promise<ActiveSession> {
  const {
    resumeWithinMs,
    model,
    definition,
    auditHook,
    onToolDeny,
    resultCapture,
    workspaceCwd,
    maxTurns,
    maxBudgetUsd,
    sdkAgents,
    skills,
    onSubagentAudit,
  } = options;

  const [validSkillPaths, validSubagentPaths] = await Promise.all([
    filterExistingPaths(definition.skillPaths, 'skill'),
    filterExistingPaths(definition.subagentPaths, 'subagent'),
  ]);

  const personaDir = dirname(definition.promptPath);
  const sessionCwd = workspaceCwd ?? personaDir;

  const { plugins, skillNames: pluginSkillNames } = await resolvePluginBundles({
    personaDir,
    skillPaths: validSkillPaths,
    sharedPlugins: definition.sharedPlugins,
  });

  const skillList = skills ?? (pluginSkillNames.length > 0 ? pluginSkillNames : undefined);

  const allowedTools = resultCapture
    ? [...definition.allowedTools, resultCapture.toolName]
    : definition.allowedTools;

  const hookEntries: NonNullable<Options['hooks']> = {};
  if (auditHook) {
    hookEntries.PostToolUse = [{ hooks: [toSDKHookCallback(auditHook)] }];
  }
  if (onSubagentAudit) {
    const subagentHook = toSDKSubagentAuditCallback(onSubagentAudit);
    hookEntries.SubagentStart = [{ hooks: [subagentHook] }];
    hookEntries.SubagentStop = [{ hooks: [subagentHook] }];
  }

  const baseOptions: Options = {
    model,
    allowedTools,
    canUseTool: buildToolAllowlistGuard(allowedTools, onToolDeny),
    cwd: sessionCwd,
    ...(plugins.length > 0 ? { plugins } : {}),
    ...(skillList && skillList.length > 0 ? { skills: skillList } : {}),
    ...(sdkAgents && Object.keys(sdkAgents).length > 0 ? { agents: sdkAgents } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
    ...(resultCapture ? { mcpServers: resultCapture.mcpServers } : {}),
    ...(Object.keys(hookEntries).length > 0 ? { hooks: hookEntries } : {}),
  };

  const shouldResume = Boolean(previousSessionId && resumeWithinMs > 0);
  const sessionId = shouldResume ? previousSessionId! : randomUUID();

  return {
    sessionId,
    isResumed: shouldResume,
    session: new QueryBackedSession(sessionId, shouldResume, baseOptions),
  };
}
