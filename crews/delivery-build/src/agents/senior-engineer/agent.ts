import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveSession,
  readPromptFile,
  readSkillsDir,
  readSubagentsDir,
  buildAuditHook,
  createPeerReviewSubmitResultCapture,
  collectSessionOutcome,
  finalizeAgentRun,
  buildPeerReviewAgentResult,
  type Agent,
  type AgentDefinition,
  type AgentInput,
  type AgentResult,
} from '@daddia/crew';
import { buildTaskPrompt } from '../prompt-context.js';

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
const DEFAULT_MODEL = 'claude-opus-4-5';

async function buildDefinition(): Promise<AgentDefinition> {
  const base = __dirname;
  const [skillPaths, subagentPaths] = await Promise.all([
    readSkillsDir(join(base, '.claude', 'skills')),
    readSubagentsDir(join(base, '.claude', 'agents')),
  ]);

  return {
    name: 'senior-engineer',
    promptPath: join(base, 'prompt.md'),
    skillPaths,
    subagentPaths,
    allowedTools: ALLOWED_TOOLS,
    mcpServerNames: ['atlassian', 'gitlab'],
    memory: 'project',
  };
}

async function run(input: AgentInput): Promise<AgentResult> {
  const definition = await buildDefinition();
  const prompt = await readPromptFile(definition.promptPath);
  const resultCapture = createPeerReviewSubmitResultCapture();

  const auditHook = buildAuditHook(definition.allowedTools, () => {});

  const { session, sessionId } = await resolveSession({
    definition,
    input,
    resumeWithinMs: RESUME_WITHIN_MS,
    model: (input.context['model'] as string | undefined) ?? DEFAULT_MODEL,
    auditHook,
    resultCapture,
  });

  const taskPrompt = buildTaskPrompt({
    personaPrompt: prompt,
    issueKey: input.issueKey,
    context: input.context,
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
