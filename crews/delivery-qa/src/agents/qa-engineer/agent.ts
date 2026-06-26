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
  collectSessionOutcome,
  finalizeAgentRun,
  formatSkillCatalogSection,
  type Agent,
  type AgentDefinition,
  type AgentInput,
  type AgentResult,
} from '@daddia/crew';
import { buildTaskPrompt } from '../prompt-context.js';
import { log } from '../../observability.js';
import { buildQaAgentResult, createQaSubmitResultCapture } from './qa-result.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const QA_TASKS = new Set([
  'deploy-qa',
  'run-automated-suite',
  'exploratory-pass',
  'document-defects',
]);

export const ALLOWED_TOOLS = [
  'Read',
  'Bash',
  'Task',
  'mcp__atlassian__jira_get_issue',
  'mcp__gitlab__get_merge_request',
  'mcp__gitlab__list_merge_request_diffs',
  'mcp__gitlab__get_file_contents',
  'mcp__gitlab__list_branches',
];

const RESUME_WITHIN_MS = 24 * 60 * 60 * 1000;

function requireModel(context: Record<string, unknown>): string | undefined {
  const model = context['model'];
  return typeof model === 'string' && model.length > 0 ? model : undefined;
}

function isQaTask(task: unknown): boolean {
  return typeof task === 'string' && QA_TASKS.has(task);
}

async function buildDefinition(): Promise<AgentDefinition> {
  const base = __dirname;
  const [skillPaths, subagentPaths] = await Promise.all([
    readSkillsDir(personaSkillsDir(base)),
    readSubagentsDir(personaAgentsDir(base)),
  ]);

  return {
    name: 'qa-engineer',
    promptPath: join(base, 'prompt.md'),
    skillPaths,
    subagentPaths,
    allowedTools: ALLOWED_TOOLS,
    mcpServerNames: ['atlassian', 'gitlab'],
    memory: 'project',
  };
}

async function run(input: AgentInput): Promise<AgentResult> {
  const task = input.context['task'];
  const qaWorkspaceDir =
    typeof input.context['qaWorkspaceDir'] === 'string'
      ? input.context['qaWorkspaceDir']
      : undefined;
  const maxTurns =
    typeof input.context['maxTurns'] === 'number' ? input.context['maxTurns'] : undefined;
  const maxBudgetUsd =
    typeof input.context['qaEngineerCostCapUsd'] === 'number'
      ? input.context['qaEngineerCostCapUsd']
      : undefined;

  if (!isQaTask(task)) {
    return {
      success: false,
      summary: `Unknown or missing QA task: ${String(task)}`,
      artefacts: {},
      costUsd: 0,
    };
  }

  if (!qaWorkspaceDir) {
    return {
      success: false,
      summary: 'QA task requires qaWorkspaceDir in context',
      artefacts: {},
      costUsd: 0,
    };
  }

  const model = requireModel(input.context);
  if (!model) {
    return {
      success: false,
      summary: 'Model routing requires model in context',
      artefacts: {},
      costUsd: 0,
    };
  }

  const definition = await buildDefinition();
  const prompt = await readPromptFile(definition.promptPath);
  const resultCapture = createQaSubmitResultCapture();

  const auditHook = buildAuditHook((event) => {
    log.info('agent.tool', {
      issueKey: input.issueKey,
      tool: event.tool,
      durationMs: event.durationMs,
    });
  });

  const previousSessionId =
    typeof input.context['previousSessionId'] === 'string'
      ? input.context['previousSessionId']
      : undefined;

  const { session, sessionId, isResumed, skillCatalog } = await resolveSession(
    {
      definition,
      input,
      resumeWithinMs: RESUME_WITHIN_MS,
      model,
      auditHook,
      resultCapture,
      workspaceCwd: qaWorkspaceDir,
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
    skillCatalogSection: formatSkillCatalogSection(skillCatalog),
  });

  try {
    await session.send(taskPrompt);
    const { resultMsg } = await collectSessionOutcome(session);

    return finalizeAgentRun({
      sessionId,
      capture: resultCapture,
      resultMsg,
      buildResult: (submitted, costUsd) => buildQaAgentResult(sessionId, submitted, costUsd),
    });
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
}

export const qaEngineer: Agent = {
  name: 'qa-engineer',
  run,
};
