import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readPromptFile, readSkillsDir, readSubagentsDir } from "@daddia/sdk";
import type { Agent, AgentDefinition, AgentInput, AgentResult } from "@daddia/contracts";

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
  };
}

async function run(input: AgentInput): Promise<AgentResult> {
  const definition = await buildDefinition();
  const prompt = await readPromptFile(definition.promptPath);

  void prompt;
  void definition;
  void input;

  throw new Error("Tech lead agent.run: Claude SDK integration not yet wired");
}

export const techLead: Agent = {
  name: "tech-lead",
  run,
};
