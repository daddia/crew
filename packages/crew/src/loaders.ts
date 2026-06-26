import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PERSONA_PLUGIN_DIR } from './plugins.js';

/**
 * Read a persona prompt file and return its text content.
 */
export async function readPromptFile(promptPath: string): Promise<string> {
  return readFile(promptPath, 'utf8');
}

/** Absolute path to a persona's local SDK plugin bundle (`plugin/`). */
export function personaPluginDir(personaDir: string): string {
  return join(personaDir, PERSONA_PLUGIN_DIR);
}

/** Absolute path to skill files within a persona plugin bundle. */
export function personaSkillsDir(personaDir: string): string {
  return join(personaPluginDir(personaDir), 'skills');
}

/** Absolute path to subagent files within a persona plugin bundle. */
export function personaAgentsDir(personaDir: string): string {
  return join(personaPluginDir(personaDir), 'agents');
}

/**
 * Discover all skill entry files under a `plugin/skills/` directory tree.
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
    } else if (entry.name === 'SKILL.md') {
      acc.push(full);
    }
  }
}

/**
 * Discover all subagent definition files under a `plugin/agents/` directory.
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
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(agentsDir, e.name))
    .sort();
}
