import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readPromptFile, readSkillsDir, readSubagentsDir } from "@daddia/sdk";
import type { Agent, AgentDefinition, AgentInput, AgentResult } from "@daddia/contracts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ALLOWED_TOOLS = [
  // GitLab MCP
  "mcp__gitlab__create_branch",
  "mcp__gitlab__push_file",
  "mcp__gitlab__list_branches",
  "mcp__gitlab__get_file_contents",
  "mcp__gitlab__create_merge_request",
  "mcp__gitlab__get_merge_request",
  "mcp__gitlab__update_merge_request",
  "mcp__gitlab__create_note",
  // Atlassian MCP
  "mcp__atlassian__jira_get_issue",
  "mcp__atlassian__jira_add_comment",
  // Bash — intentionally omitted for MVP; add when test execution is wired in
];

async function buildDefinition(): Promise<AgentDefinition> {
  const base = __dirname;
  const [skillPaths, subagentPaths] = await Promise.all([
    readSkillsDir(join(base, ".claude", "skills")),
    readSubagentsDir(join(base, ".claude", "agents")),
  ]);

  return {
    name: "engineer",
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

  // TODO: replace with real Claude SDK session call.
  // The definition, prompt, and input are ready; wire in sdk/session.ts here.
  void prompt;
  void definition;
  void input;

  throw new Error("Engineer agent.run: Claude SDK integration not yet wired");
}

export const engineer: Agent = {
  name: "engineer",
  run,
};
