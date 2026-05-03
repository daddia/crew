import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent, AgentDefinition, AgentInput, AgentResult } from "@daddia/contracts";
import { readPromptFile, readSkillsDir } from "@daddia/sdk";

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
  };
}

async function run(input: AgentInput): Promise<AgentResult> {
  const definition = await buildDefinition();
  const prompt = await readPromptFile(definition.promptPath);

  // TODO: wire Claude SDK session call here — definition, prompt, and input are ready.
  void prompt;
  void definition;
  void input;

  throw new Error("code-quality agent.run: Claude SDK integration not yet wired");
}

export const codeQuality: Agent = {
  name: "code-quality",
  run,
};
