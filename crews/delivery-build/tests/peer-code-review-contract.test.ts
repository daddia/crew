/**
 * RH01-03: peer-code-review skill inputs and tools must match the workflow's
 * pre-MR branch contract (solution.md §5.2 — peer review before open MR).
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { CODE_REVIEW_PLUGIN_PATH } from '@daddia/crew';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(__dirname, '../src/agents');

const SKILL_PATH = join(CODE_REVIEW_PLUGIN_PATH, 'skills', 'code-review', 'SKILL.md');

/** Context keys the workflow passes to senior-engineer for peer-code-review. */
const WORKFLOW_PEER_REVIEW_CONTEXT = new Set(['task', 'branchName', 'model', 'maxTurns']);

/** Tools that require an open MR and must not appear in the pre-MR allowlist. */
const MR_ONLY_TOOLS = [
  'mcp__gitlab__get_merge_request',
  'mcp__gitlab__list_merge_request_diffs',
  'mcp__gitlab__create_note',
];

/** Branch-diff tools the skill steps reference for pre-MR review. */
const BRANCH_REVIEW_TOOLS = [
  'mcp__gitlab__get_branch_diffs',
  'mcp__gitlab__list_branches',
  'mcp__gitlab__get_file_contents',
  'mcp__atlassian__jira_get_issue',
];

function parseRequiredSkillInputs(skillMarkdown: string): Map<string, 'context' | 'input'> {
  const required = new Map<string, 'context' | 'input'>();
  const inputsSection = skillMarkdown.match(/## Inputs[\s\S]*?(?=\n## )/)?.[0] ?? '';
  const rowRe = /\|\s*`(\w+)`\s*\|\s*(top-level `AgentInput`|`context`)\s*\|\s*yes\s*\|/g;

  for (const match of inputsSection.matchAll(rowRe)) {
    const field = match[1];
    if (!field) continue;
    const row = match[0];
    required.set(field, row.includes('top-level `AgentInput`') ? 'input' : 'context');
  }

  return required;
}

describe('peer-code-review contract (RH01-03)', () => {
  it('Gherkin: every required skill input is present in workflow context', async () => {
    const skillMarkdown = await readFile(SKILL_PATH, 'utf8');
    const required = parseRequiredSkillInputs(skillMarkdown);

    expect(required.has('issueKey')).toBe(true);
    expect(required.get('issueKey')).toBe('input');
    expect(required.has('branchName')).toBe(true);
    expect(required.get('branchName')).toBe('context');

    for (const [field, source] of required) {
      if (source === 'context') {
        expect(WORKFLOW_PEER_REVIEW_CONTEXT.has(field)).toBe(true);
      }
    }

    expect(required.has('mrUrl')).toBe(false);
    expect(required.has('diff')).toBe(false);
  });

  it('Gherkin: skill steps do not reference pre-MR artefacts (MR URL, MR diffs, MR notes)', async () => {
    const skillMarkdown = await readFile(SKILL_PATH, 'utf8');

    expect(skillMarkdown).not.toMatch(/`mrUrl`/);
    expect(skillMarkdown).not.toMatch(/context\.diff/);
    expect(skillMarkdown).not.toMatch(
      /Call `mcp__gitlab__list_merge_request_diffs`/,
    );
    expect(skillMarkdown).not.toMatch(/Post a single summary note via `mcp__gitlab__create_note`/);
    expect(skillMarkdown).toContain('`branchName`');
    expect(skillMarkdown).toContain('mcp__gitlab__get_branch_diffs');
  });

  it('Gherkin: senior-engineer allowlist supports branch review and excludes MR-only tools', async () => {
    const { seniorEngineer } = await import('../src/agents/senior-engineer/agent.js');
    void seniorEngineer;

    const agentSource = await readFile(join(agentsDir, 'senior-engineer', 'agent.ts'), 'utf8');
    const allowlistMatch = agentSource.match(/const ALLOWED_TOOLS = \[([\s\S]*?)\];/);
    expect(allowlistMatch).not.toBeNull();

    const allowlistBlock = allowlistMatch![1]!;
    for (const tool of MR_ONLY_TOOLS) {
      expect(allowlistBlock).not.toContain(tool);
    }
    for (const tool of BRANCH_REVIEW_TOOLS) {
      expect(allowlistBlock).toContain(tool);
    }
  });
});
