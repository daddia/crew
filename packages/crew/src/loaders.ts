import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Read a persona's prompt.md and return its text content.
 */
export async function readPromptFile(promptPath: string): Promise<string> {
  return readFile(promptPath, "utf8");
}

/**
 * Discover all SKILL.md files under a `.claude/skills/` directory tree.
 * Returns absolute paths sorted alphabetically.
 */
export async function readSkillsDir(skillsDir: string): Promise<string[]> {
  const paths: string[] = [];
  await collectSkillFiles(skillsDir, paths);
  return paths.sort();
}

async function collectSkillFiles(dir: string, acc: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Directory does not exist — return empty.
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSkillFiles(full, acc);
    } else if (entry.name === "SKILL.md") {
      acc.push(full);
    }
  }
}

/**
 * Discover all subagent .md files under a `.claude/agents/` directory.
 * Returns absolute paths sorted alphabetically.
 */
export async function readSubagentsDir(agentsDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => join(agentsDir, e.name))
    .sort();
}
