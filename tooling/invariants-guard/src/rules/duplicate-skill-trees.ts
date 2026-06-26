import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Violation } from '../types.js';

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findPersonaDirs(crewsDir: string): Promise<string[]> {
  const personas: string[] = [];
  let crewEntries;
  try {
    crewEntries = await readdir(crewsDir, { withFileTypes: true });
  } catch {
    return personas;
  }

  for (const crew of crewEntries) {
    if (!crew.isDirectory()) continue;
    const agentsDir = join(crewsDir, crew.name, 'src', 'agents');
    let personaEntries;
    try {
      personaEntries = await readdir(agentsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const persona of personaEntries) {
      if (persona.isDirectory()) {
        personas.push(join(agentsDir, persona.name));
      }
    }
  }
  return personas;
}

/**
 * Personas must not host skills/subagents in both legacy `.claude/` and canonical `plugin/`.
 */
export async function checkDuplicateSkillTrees(crewsDir: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  const personaDirs = await findPersonaDirs(crewsDir);

  const pairs = [
    { legacy: '.claude/skills', canonical: 'plugin/skills', kind: 'skills' },
    { legacy: '.claude/agents', canonical: 'plugin/agents', kind: 'subagents' },
  ] as const;

  for (const personaDir of personaDirs) {
    for (const { legacy, canonical, kind } of pairs) {
      const legacyPath = join(personaDir, legacy);
      const canonicalPath = join(personaDir, canonical);
      if ((await pathExists(legacyPath)) && (await pathExists(canonicalPath))) {
        violations.push({
          ruleId: 'no-duplicate-skill-trees',
          filePath: personaDir,
          line: 1,
          message: `Duplicate ${kind} trees: both ${legacy} and ${canonical} exist`,
        });
      }
    }
  }

  return violations;
}
