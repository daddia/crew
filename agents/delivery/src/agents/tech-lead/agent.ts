import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveSession,
  readPromptFile,
  readSkillsDir,
  readSubagentsDir,
  buildAuditHook,
  type SDKResultMessage,
  type Agent,
  type AgentDefinition,
  type AgentInput,
  type AgentResult,
} from "@daddia/crew";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ALLOWED_TOOLS = [
  // GitLab MCP — read-only + approve
  "mcp__gitlab__get_merge_request",
  "mcp__gitlab__list_merge_request_diffs",
  "mcp__gitlab__get_file_contents",
  "mcp__gitlab__approve_merge_request",
  "mcp__gitlab__create_note",
  // Atlassian MCP — read-only
  "mcp__atlassian__jira_get_issue",
];

const RESUME_WITHIN_MS = 0; // each review phase starts fresh
const DEFAULT_MODEL = "claude-opus-4-5";

async function buildDefinition(): Promise<AgentDefinition> {
  const base = __dirname;
  const [skillPaths, subagentPaths] = await Promise.all([
    readSkillsDir(join(base, ".claude", "skills")),
    readSubagentsDir(join(base, ".claude", "agents")),
  ]);

  return {
    name: "tech-lead",
    promptPath: join(base, "prompt.md"),
    skillPaths,
    subagentPaths,
    allowedTools: ALLOWED_TOOLS,
    mcpServerNames: ["atlassian", "gitlab"],
    memory: "project",
  };
}

async function run(input: AgentInput): Promise<AgentResult> {
  const definition = await buildDefinition();
  const prompt = await readPromptFile(definition.promptPath);

  const auditHook = buildAuditHook(definition.allowedTools, () => {});

  const { session, sessionId } = await resolveSession({
    definition,
    input,
    resumeWithinMs: RESUME_WITHIN_MS,
    model: process.env["ANTHROPIC_MODEL"] ?? DEFAULT_MODEL,
    auditHook,
  });

  // SECURITY: input.context is constructed by the workflow from trusted
  // internal values (task, mrUrl). Never pass user-supplied data
  // here without sanitising it first.
  const taskPrompt = [
    prompt,
    "---",
    `Issue: ${input.issueKey}`,
    `Context: ${JSON.stringify(input.context)}`,
  ].join("\n\n");

  try {
    await session.send(taskPrompt);

    let resultMsg: SDKResultMessage | undefined;
    for await (const msg of session.stream()) {
      if (msg.type === "result") {
        resultMsg = msg;
        break;
      }
    }

    if (!resultMsg) {
      return {
        success: false,
        summary: "Session ended without a result message",
        artefacts: { sessionId },
        costUsd: 0,
      };
    }

    if (resultMsg.subtype === "success") {
      return {
        success: true,
        summary: resultMsg.result,
        artefacts: { sessionId },
        costUsd: resultMsg.total_cost_usd,
      };
    }

    return {
      success: false,
      summary: resultMsg.errors.join("; "),
      artefacts: { sessionId },
      costUsd: resultMsg.total_cost_usd,
    };
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
  name: "tech-lead",
  run,
};
