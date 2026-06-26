import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveSession,
  readPromptFile,
  createRunStreamBridge,
  createPeerReviewSubmitResultCapture,
  collectSessionOutcome,
  finalizeAgentRun,
  buildPeerReviewAgentResult,
  CODE_REVIEW_PLUGIN_PATH,
  formatSkillCatalogSection,
  type Agent,
  type AgentDefinition,
  type AgentInput,
  type AgentResult,
} from '@daddia/crew';
import { buildTaskPrompt } from '../prompt-context.js';
import { runStreamHub } from '../../run-stream-hub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ALLOWED_TOOLS = [
  // GitLab MCP — read-only branch review (pre-MR)
  'mcp__gitlab__get_branch_diffs',
  'mcp__gitlab__get_file_contents',
  'mcp__gitlab__list_branches',
  // Atlassian MCP — read-only
  'mcp__atlassian__jira_get_issue',
];

const RESUME_WITHIN_MS = 0; // peer review always starts fresh

function requireModel(context: Record<string, unknown>): string | undefined {
  const model = context['model'];
  return typeof model === 'string' && model.length > 0 ? model : undefined;
}

async function buildDefinition(): Promise<AgentDefinition> {
  const base = __dirname;
  const codeReviewSkill = join(CODE_REVIEW_PLUGIN_PATH, 'skills', 'code-review', 'SKILL.md');

  return {
    name: 'senior-engineer',
    promptPath: join(base, 'prompt.md'),
    skillPaths: [codeReviewSkill],
    subagentPaths: [],
    sharedPlugins: ['code-review'],
    allowedTools: ALLOWED_TOOLS,
    mcpServerNames: ['atlassian', 'gitlab'],
    memory: 'project',
  };
}

async function run(input: AgentInput): Promise<AgentResult> {
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
  const resultCapture = createPeerReviewSubmitResultCapture();
  const maxTurns =
    typeof input.context['maxTurns'] === 'number' ? input.context['maxTurns'] : undefined;

  const sessionIdRef = { current: '' };

  const { auditHook, onSubagentAudit } = createRunStreamBridge(
    runStreamHub,
    input.issueKey,
    () => sessionIdRef.current,
    { allowedTools: definition.allowedTools },
  );

  const { session, sessionId, skillCatalog } = await resolveSession({
    definition,
    input,
    resumeWithinMs: RESUME_WITHIN_MS,
    model,
    auditHook,
    onSubagentAudit,
    resultCapture,
    maxTurns,
  });

  sessionIdRef.current = sessionId;

  const taskPrompt = buildTaskPrompt({
    personaPrompt: prompt,
    issueKey: input.issueKey,
    context: input.context,
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
        buildPeerReviewAgentResult(sessionId, submitted, costUsd),
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

export const seniorEngineer: Agent = {
  name: 'senior-engineer',
  run,
};
