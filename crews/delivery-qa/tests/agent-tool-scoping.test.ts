import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSkillsDir, personaSkillsDir } from '@daddia/crew';
import { ALLOWED_TOOLS } from '../src/agents/qa-engineer/agent.js';
import { isProtectedBranchTool } from '../src/agents/prompt-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(__dirname, '../src/agents');

describe('agent tool scoping', () => {
  it('qa-engineer exports the correct persona name', async () => {
    const { qaEngineer } = await import('../src/agents/qa-engineer/agent.js');
    expect(qaEngineer.name).toBe('qa-engineer');
  });

  it('qa-engineer has four skills loaded from plugin/skills', async () => {
    const base = join(agentsDir, 'qa-engineer');
    const skillPaths = await readSkillsDir(personaSkillsDir(base));
    expect(skillPaths.length).toBe(4);
  });

  it('qa-engineer allowlist excludes merge, approve, and protected-branch push tools', () => {
    for (const tool of ALLOWED_TOOLS) {
      expect(isProtectedBranchTool(tool)).toBe(false);
    }

    expect(ALLOWED_TOOLS).not.toContain('mcp__gitlab__merge_request');
    expect(ALLOWED_TOOLS).not.toContain('mcp__gitlab__merge_merge_request');
    expect(ALLOWED_TOOLS).not.toContain('mcp__gitlab__approve_merge_request');
    expect(ALLOWED_TOOLS).not.toContain('mcp__gitlab__push_file');
  });

  it('qa-engineer has read-only GitLab and workspace tools', () => {
    expect(ALLOWED_TOOLS).toContain('Read');
    expect(ALLOWED_TOOLS).toContain('Bash');
    expect(ALLOWED_TOOLS).toContain('mcp__gitlab__get_merge_request');
    expect(ALLOWED_TOOLS).not.toContain('mcp__gitlab__create_note');
    expect(ALLOWED_TOOLS).not.toContain('mcp__gitlab__create_merge_request');
  });
});
