import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export interface ParsedSubagent {
  name: string;
  description: string;
  prompt: string;
}

export interface SdkSubagentDefinition {
  description: string;
  prompt: string;
  tools: string[];
}

/** Parse a `plugin/agents/*.md` subagent file with optional YAML frontmatter. */
export async function parseSubagentFile(filePath: string): Promise<ParsedSubagent> {
  const raw = await readFile(filePath, 'utf8');
  const frontmatterMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!frontmatterMatch) {
    const fallbackName = basename(filePath, '.md');
    return {
      name: fallbackName,
      description: `Subagent ${fallbackName}`,
      prompt: raw.trim(),
    };
  }

  const frontmatter = frontmatterMatch[1] ?? '';
  const body = (frontmatterMatch[2] ?? '').trim();
  const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? basename(filePath, '.md');
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? `Subagent ${name}`;

  return { name, description, prompt: body };
}

/** Build the SDK `agents` map from subagent markdown paths. */
export async function buildSdkAgentsMap(
  subagentPaths: string[],
  tools: string[] = ['Read', 'Grep', 'Glob', 'Bash'],
): Promise<Record<string, SdkSubagentDefinition>> {
  const agents: Record<string, SdkSubagentDefinition> = {};
  for (const path of subagentPaths) {
    const parsed = await parseSubagentFile(path);
    agents[parsed.name] = {
      description: parsed.description,
      prompt: parsed.prompt,
      tools,
    };
  }
  return agents;
}
