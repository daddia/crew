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
import {
  buildFinalReviewAgentResult,
  buildPublishSummaryAgentResult,
  createFinalReviewSubmitResultCapture,
} from './final-review-result.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type TechLeadTask = 'final-code-review' | 'publish-review-summary';

const TECH_LEAD_TASKS = new Set<TechLeadTask>(['final-code-review', 'publish-review-summary']);

export const REVIEW_ALLOWED_TOOLS = [
  'mcp__gitlab__get_merge_request',
  'mcp__gitlab__list_merge_request_diffs',
  'mcp__gitlab__get_file_contents',
  'mcp__atlassian__jira_get_issue',
] as const;

export const SUMMARY_ALLOWED_TOOLS = [
  'mcp__atlassian__jira_get_issue',
  'mcp__atlassian__jira_add_comment',
] as const;

const RESUME_WITHIN_MS = 24 * 60 * 60 * 1000;

function requireModel(context: Record<string, unknown>): string | undefined {
  const model = context['model'];
  return typeof model === 'string' && model.length > 0 ? model : undefined;
}

function isTechLeadTask(task: unknown): task is TechLeadTask {
  return typeof task === 'string' && TECH_LEAD_TASKS.has(task as TechLeadTask);
}

export function getAllowedToolsForTask(task: TechLeadTask): readonly string[] {
  return task === 'final-code-review' ? REVIEW_ALLOWED_TOOLS : SUMMARY_ALLOWED_TOOLS;
}

function getMcpServerNames(task: TechLeadTask): string[] {
  return task === 'final-code-review' ? ['atlassian', 'gitlab'] : ['atlassian'];
}

async function buildDefinition(task: TechLeadTask): Promise<AgentDefinition> {
  const base = __dirname;
  const [skillPaths, subagentPaths] = await Promise.all([
    readSkillsDir(personaSkillsDir(base)),
    readSubagentsDir(personaAgentsDir(base)),
  ]);

  return {
    name: 'tech-lead',
    promptPath: join(base, 'prompt.md'),
    skillPaths,
    subagentPaths,
    allowedTools: [...getAllowedToolsForTask(task)],
    mcpServerNames: getMcpServerNames(task),
    memory: 'project',
  };
}

async function run(input: AgentInput): Promise<AgentResult> {
  const task = input.context['task'];
  const maxTurns =
    typeof input.context['maxTurns'] === 'number' ? input.context['maxTurns'] : undefined;
  const maxBudgetUsd =
    typeof input.context['techLeadCostCapUsd'] === 'number'
      ? input.context['techLeadCostCapUsd']
      : undefined;

  if (!isTechLeadTask(task)) {
    return {
      success: false,
      summary: `Unknown or missing tech-lead task: ${String(task)}`,
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

  const definition = await buildDefinition(task);
  const allowedTools = definition.allowedTools;
  const prompt = await readPromptFile(definition.promptPath);
  const resultCapture = createFinalReviewSubmitResultCapture();

  const auditHook = buildAuditHook(allowedTools, (event) => {
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
      buildResult: (submitted, costUsd) =>
        task === 'publish-review-summary'
          ? buildPublishSummaryAgentResult(sessionId, submitted, costUsd)
          : buildFinalReviewAgentResult(sessionId, submitted, costUsd),
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

export const techLead: Agent = {
  name: 'tech-lead',
  run,
};
