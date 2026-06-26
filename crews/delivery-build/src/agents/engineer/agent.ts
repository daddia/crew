import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveSession,
  readPromptFile,
  readSkillsDir,
  readSubagentsDir,
  personaSkillsDir,
  personaAgentsDir,
  buildAuditHook,
  createEngineerSubmitResultCapture,
  collectSessionOutcome,
  finalizeAgentRun,
  buildEngineerAgentResult,
  prepareEngineerWorkspace,
  type Agent,
  type AgentDefinition,
  type AgentInput,
  type AgentResult,
  type SubagentAuditEvent,
  type ToolUseEvent,
} from '@daddia/crew';
import { buildTaskPrompt } from '../prompt-context.js';
import { log } from '../../observability.js';
import { withWorkspaceLock } from '../../workspace-lock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKSPACE_TASKS = new Set(['implement-story', 'address-feedback', 'fix-ci']);

const MCP_ONLY_TOOLS = [
  'mcp__atlassian__jira_get_issue',
  'mcp__atlassian__jira_add_comment',
];

const WORKSPACE_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Task',
  'mcp__atlassian__jira_get_issue',
  'mcp__atlassian__jira_add_comment',
  'mcp__gitlab__get_merge_request',
  'mcp__gitlab__create_note',
  'mcp__gitlab__list_merge_request_diffs',
];

const RESUME_WITHIN_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MODEL = 'claude-opus-4-5';

function usesWorkspace(task: unknown): boolean {
  return typeof task === 'string' && WORKSPACE_TASKS.has(task);
}

function allowedToolsForTask(task: unknown): string[] {
  return usesWorkspace(task) ? WORKSPACE_TOOLS : MCP_ONLY_TOOLS;
}

async function buildDefinition(allowedTools: string[]): Promise<AgentDefinition> {
  const base = __dirname;
  const [skillPaths, subagentPaths] = await Promise.all([
    readSkillsDir(personaSkillsDir(base)),
    readSubagentsDir(personaAgentsDir(base)),
  ]);

  return {
    name: 'engineer',
    promptPath: join(base, 'prompt.md'),
    skillPaths,
    subagentPaths,
    allowedTools,
    mcpServerNames: ['atlassian', 'gitlab'],
    memory: 'project',
  };
}

async function run(input: AgentInput): Promise<AgentResult> {
  const task = input.context['task'];
  const projectDir =
    typeof input.context['projectDir'] === 'string' ? input.context['projectDir'] : undefined;
  const branchName =
    typeof input.context['branchName'] === 'string' ? input.context['branchName'] : undefined;
  const maxTurns =
    typeof input.context['maxTurns'] === 'number' ? input.context['maxTurns'] : undefined;
  const maxBudgetUsd =
    typeof input.context['engineerCostCapUsd'] === 'number'
      ? input.context['engineerCostCapUsd']
      : undefined;

  const workspaceMode = usesWorkspace(task) && projectDir !== undefined;

  if (usesWorkspace(task) && !projectDir) {
    return {
      success: false,
      summary: 'Workspace task requires projectDir in context',
      artefacts: {},
      costUsd: 0,
    };
  }

  const execute = async (): Promise<AgentResult> => {
    if (workspaceMode && projectDir) {
      try {
        await prepareEngineerWorkspace(projectDir, { branchName });
      } catch (err) {
        return {
          success: false,
          summary: err instanceof Error ? err.message : String(err),
          artefacts: {},
          costUsd: 0,
        };
      }
    }

    const definition = await buildDefinition(allowedToolsForTask(task));
    const prompt = await readPromptFile(definition.promptPath);
    const resultCapture = createEngineerSubmitResultCapture();

    const auditEvents: Array<ToolUseEvent | SubagentAuditEvent> = [];
    const auditHook = buildAuditHook(definition.allowedTools, (event) => {
      auditEvents.push(event);
      log.info('agent.tool', {
        issueKey: input.issueKey,
        tool: event.tool,
        durationMs: event.durationMs,
      });
    });

    const onSubagentAudit = (event: SubagentAuditEvent) => {
      auditEvents.push(event);
      log.info('agent.subagent', {
        issueKey: input.issueKey,
        phase: event.phase,
        agentType: event.agentType,
        agentId: event.agentId,
      });
    };

    const previousSessionId =
      typeof input.context['previousSessionId'] === 'string'
        ? input.context['previousSessionId']
        : undefined;

    const { session, sessionId, isResumed } = await resolveSession(
      {
        definition,
        input,
        resumeWithinMs: RESUME_WITHIN_MS,
        model: (input.context['model'] as string | undefined) ?? DEFAULT_MODEL,
        auditHook,
        onSubagentAudit,
        resultCapture,
        workspaceCwd: workspaceMode ? projectDir : undefined,
        maxTurns,
        maxBudgetUsd,
      },
      previousSessionId,
    );

    const taskPrompt = buildTaskPrompt({
      personaPrompt: prompt,
      issueKey: input.issueKey,
      context: input.context,
      isResumed,
    });

    try {
      await session.send(taskPrompt);
      const { resultMsg } = await collectSessionOutcome(session);

      const result = finalizeAgentRun({
        sessionId,
        capture: resultCapture,
        resultMsg,
        buildResult: (submitted, costUsd) =>
          buildEngineerAgentResult(sessionId, submitted, costUsd),
      });

      if (auditEvents.length > 0) {
        result.artefacts['auditTrail'] = auditEvents;
      }

      return result;
    } catch (err) {
      return {
        success: false,
        summary: err instanceof Error ? err.message : String(err),
        artefacts: { sessionId },
        costUsd: 0,
      };
    } finally {
      await session[Symbol.asyncDispose]();
    }
  };

  if (workspaceMode) {
    return withWorkspaceLock(execute);
  }
  return execute();
}

export const engineer: Agent = {
  name: 'engineer',
  run,
};
