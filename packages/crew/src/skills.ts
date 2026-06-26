import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { namespacedSkillName } from './plugins.js';

/** Metadata for one persona skill — descriptions only, not the full SKILL.md body. */
export interface SkillCatalogEntry {
  /** Directory name or frontmatter `name`. */
  name: string;
  /** Short summary advertised to the model before a skill is activated. */
  description: string;
  /** Absolute path to `SKILL.md`. */
  path: string;
  /** Workflow task(s) that activate this skill. Defaults to {@link name}. */
  tasks: string[];
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  when?: string;
  task?: string;
  tasks?: string[];
}

const TASK_CONTEXT_PATTERN = /context\.task\s*===\s*["']([^"']+)["']/g;

/** Derive the skill identifier from a `.../skill-name/SKILL.md` path. */
export function skillNameFromPath(skillPath: string): string {
  return basename(dirname(skillPath));
}

function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const parsed = parseYaml(match[1] ?? '') as SkillFrontmatter;
  return { frontmatter: parsed ?? {}, body: content.slice(match[0].length) };
}

function resolveTasks(name: string, frontmatter: SkillFrontmatter, body: string): string[] {
  if (Array.isArray(frontmatter.tasks) && frontmatter.tasks.length > 0) {
    return frontmatter.tasks.filter((t): t is string => typeof t === 'string' && t.length > 0);
  }
  const single = frontmatter.when ?? frontmatter.task;
  if (typeof single === 'string' && single.length > 0) {
    return [single];
  }
  const fromBody: string[] = [];
  const slice = body.slice(0, 1200);
  for (const match of slice.matchAll(TASK_CONTEXT_PATTERN)) {
    const task = match[1];
    if (task && !fromBody.includes(task)) {
      fromBody.push(task);
    }
  }
  if (fromBody.length > 0) {
    return fromBody;
  }
  return [name];
}

function extractDescription(name: string, frontmatter: SkillFrontmatter, body: string): string {
  if (typeof frontmatter.description === 'string' && frontmatter.description.trim().length > 0) {
    return frontmatter.description.trim();
  }

  const jobMatch = body.match(/Your job is to ([^\n]+)/i);
  if (jobMatch?.[1]) {
    return jobMatch[1].trim().replace(/\.\s*$/, '');
  }

  const sharedMatch = body.match(/^Shared [^\n]+\n([^\n]+)/m);
  if (sharedMatch?.[1]) {
    return sharedMatch[1].trim().replace(/\.\s*$/, '');
  }

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.includes('context.task ===') || trimmed.startsWith('You are running')) {
      continue;
    }
    if (trimmed.length >= 16) {
      return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
    }
  }

  return `Procedure for ${name}`;
}

/** Parse skill metadata from a SKILL.md file without returning the full procedure body. */
export function parseSkillMetadata(content: string, skillPath: string): SkillCatalogEntry {
  const { frontmatter, body } = parseFrontmatter(content);
  const name =
    typeof frontmatter.name === 'string' && frontmatter.name.length > 0
      ? frontmatter.name
      : skillNameFromPath(skillPath);

  return {
    name,
    description: extractDescription(name, frontmatter, body),
    path: skillPath,
    tasks: resolveTasks(name, frontmatter, body),
  };
}

/** Load description metadata for each skill path (sorted by name). */
export async function readSkillCatalog(skillPaths: string[]): Promise<SkillCatalogEntry[]> {
  const entries = await Promise.all(
    skillPaths.map(async (path) => {
      const content = await readFile(path, 'utf8');
      return parseSkillMetadata(content, path);
    }),
  );
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether a catalog entry should be active for the given workflow task. */
export function skillMatchesTask(entry: SkillCatalogEntry, task: string): boolean {
  return entry.tasks.includes(task);
}

/**
 * Filter namespaced SDK skill names to those matching `task`.
 * Shared-plugin skills use the same matching rules via catalog entries.
 */
export function resolveSkillsForTask(
  task: string,
  catalog: SkillCatalogEntry[],
  namespacedSkillNames: string[],
): string[] {
  const active = new Set(
    catalog.filter((entry) => skillMatchesTask(entry, task)).map((entry) => entry.name),
  );
  if (active.size === 0) {
    return [];
  }

  return namespacedSkillNames.filter((namespaced) => {
    const skillPart = namespaced.includes(':')
      ? namespaced.slice(namespaced.indexOf(':') + 1)
      : namespaced;
    return active.has(skillPart);
  });
}

/** Namespaced SDK skill names for catalog entries that match `task`. */
export function activeNamespacedSkillsForTask(
  task: string,
  pluginName: string,
  catalog: SkillCatalogEntry[],
): string[] {
  return catalog
    .filter((entry) => skillMatchesTask(entry, task))
    .map((entry) => namespacedSkillName(pluginName, entry.name));
}

/**
 * Markdown section listing every skill description for the persona prompt.
 * Full SKILL.md bodies are loaded only for skills enabled on the SDK session.
 */
export function formatSkillCatalogSection(catalog: SkillCatalogEntry[] | undefined): string {
  if (!catalog || catalog.length === 0) {
    return '';
  }

  const lines = catalog.map((entry) => `- **${entry.name}** — ${entry.description}`);
  return [
    '## Available skills',
    '',
    'Skill descriptions are listed below. Only the skill matching `context.task` is pre-loaded;',
    'invoke the Skill tool to load a different procedure if the task changes.',
    '',
    ...lines,
  ].join('\n');
}
