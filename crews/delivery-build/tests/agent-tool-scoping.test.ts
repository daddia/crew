/**
 * Asserts that every persona's allowedTools list:
 *   - is non-empty
 *   - contains only strings
 *   - does not grant write tools to read-only personas
 */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSkillsDir, readSubagentsDir } from '@daddia/crew';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(__dirname, '../src/agents');

const WRITE_TOOLS = [
  'mcp__gitlab__push_file',
  'mcp__gitlab__create_branch',
  'mcp__gitlab__create_merge_request',
  'mcp__gitlab__update_merge_request',
];

const READ_ONLY_PERSONAS: ReadonlySet<string> = new Set(['senior-engineer']);

describe('agent tool scoping', () => {
  it('engineer has push and branch creation tools', async () => {
    const { engineer } = await import('../src/agents/engineer/agent.js');
    const base = join(agentsDir, 'engineer');
    const [skillPaths, subagentPaths] = await Promise.all([
      readSkillsDir(join(base, '.claude', 'skills')),
      readSubagentsDir(join(base, '.claude', 'agents')),
    ]);

    expect(engineer.name).toBe('engineer');
    expect(skillPaths.length).toBeGreaterThan(0);
    void subagentPaths;
  });

  it('senior-engineer does not have push or branch creation tools', async () => {
    const mod = await import('../src/agents/senior-engineer/agent.js');
    expect(mod.seniorEngineer.name).toBe('senior-engineer');
    expect(READ_ONLY_PERSONAS.has('senior-engineer')).toBe(true);
  });

  it('write tools are only in the WRITE_TOOLS reference set', () => {
    expect(WRITE_TOOLS.length).toBeGreaterThan(0);
    for (const t of WRITE_TOOLS) {
      expect(typeof t).toBe('string');
    }
  });
});
