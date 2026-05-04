import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveSession,
  readPromptFile,
  readSkillsDir,
  buildAuditHook,
} from "@daddia/sdk";
import type { SDKResultMessage } from "@daddia/sdk";
import type { Agent, AgentDefinition, AgentInput, AgentResult } from "@daddia/contracts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read-only by design — no create_note or any write tool.
// Posting is handled by poster.ts via the REST API, not by the agent.
// The diff is pre-fetched by context.ts and passed in via AgentInput.context.diff,
// so list_merge_request_diffs is intentionally omitted to avoid a redundant fetch.
const ALLOWED_TOOLS = [
  "mcp__gitlab__get_merge_request",
  "mcp__gitlab__get_file_contents",
  "mcp__gitlab__get_repository_file",
  "mcp__gitlab__list_repository_tree",
  "mcp__gitlab__search_code",
];

const RESUME_WITHIN_MS = 0; // each code review starts fresh
const DEFAULT_MODEL = "claude-opus-4-5";

async function buildDefinition(): Promise<AgentDefinition> {
  const base = __dirname;
  const skillPaths = await readSkillsDir(join(base, ".claude", "skills"));

  return {
    name: "code-quality",
    promptPath: join(base, "prompt.md"),
    skillPaths,
    subagentPaths: [],
    allowedTools: ALLOWED_TOOLS,
    mcpServerNames: ["gitlab"],
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

export const codeQuality: Agent = {
  name: "code-quality",
  run,
};
