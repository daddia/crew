export type { PersonaName, AgentInput, AgentResult, Agent, AgentDefinition } from './agent.js';

export type { AgentCrew } from './unit.js';

export { resolveSession } from './session.js';
export type {
  SessionOptions,
  ActiveSession,
  AgentSession,
  CompactionEvent,
  CompactionHandler,
} from './session.js';
export {
  COMPACTION_THRESHOLD_MIN,
  COMPACTION_THRESHOLD_MAX,
  DEFAULT_COMPACTION_THRESHOLD,
} from './session.js';
export type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

export {
  readPromptFile,
  readSkillsDir,
  readSubagentsDir,
  personaPluginDir,
  personaSkillsDir,
  personaAgentsDir,
} from './loaders.js';

export {
  skillNameFromPath,
  parseSkillMetadata,
  readSkillCatalog,
  skillMatchesTask,
  resolveSkillsForTask,
  activeNamespacedSkillsForTask,
  formatSkillCatalogSection,
} from './skills.js';
export type { SkillCatalogEntry } from './skills.js';

export {
  CODE_REVIEW_PLUGIN_PATH,
  PERSONA_PLUGIN_DIR,
  sharedPluginRef,
  personaPluginRef,
  namespacedSkillName,
  namespacedSkillNamesFromPaths,
  resolvePluginBundles,
} from './plugins.js';
export type { SharedPluginName, ResolvedPlugin } from './plugins.js';

export {
  syncPersonaClaudeAssets,
  prepareEngineerWorkspace,
  skillNamesFromPaths,
  WorkspaceError,
} from './workspace.js';
export type { PrepareWorkspaceOptions } from './workspace.js';

export { parseSubagentFile, buildSdkAgentsMap } from './subagents.js';
export type { ParsedSubagent, SdkSubagentDefinition } from './subagents.js';

export {
  buildAuditHook,
  buildToolAllowlistGuard,
  toSDKHookCallback,
  toSDKSubagentAuditCallback,
  boundedIterGuard,
  IterationCapReached,
} from './hooks.js';
export type {
  ToolUseEvent,
  PostToolUseHandler,
  ToolDenialEvent,
  ToolDenialHandler,
  SubagentAuditEvent,
  SubagentAuditHandler,
} from './hooks.js';

export { createRunStreamHub, createRunStreamBridge, formatRunProgressSse } from './run-stream.js';
export type {
  RunProgressEnvelope,
  RunStepProgressEvent,
  RunToolUseProgressEvent,
  RunSubagentProgressEvent,
  RunProgressEvent,
  RunProgressPublishInput,
  RunStreamHub,
  RunStreamBridgeOptions,
} from './run-stream.js';

export { createLogger, initTracing, createTracer } from './observability/index.js';
export type { Logger, LogLevel, LogRecord, TracingOptions, Tracer } from './observability/index.js';

export { seedProjectMemory, memoryPath } from './memory/index.js';

export type { Orchestrator, OrchestratorRequest, AgentRegistry } from './orchestrator.js';

export {
  SUBMIT_RESULT_SERVER_NAME,
  SUBMIT_RESULT_TOOL_NAME,
  peerReviewArtefactsShape,
  createSubmitResultCapture,
  buildSubmitResultHandler,
  createEngineerSubmitResultCapture,
  createPeerReviewSubmitResultCapture,
  flattenReviewComments,
  collectSessionOutcome,
  finalizeAgentRun,
  buildEngineerAgentResult,
  buildPeerReviewAgentResult,
} from './result.js';
export type {
  SubmittedAgentResult,
  SubmitResultCapture,
  FinalizeAgentRunOptions,
} from './result.js';
