import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSkillsDir, personaSkillsDir } from '@daddia/crew';
import {
  getAllowedToolsForTask,
  REVIEW_ALLOWED_TOOLS,
  SUMMARY_ALLOWED_TOOLS,
} from '../src/agents/tech-lead/agent.js';
import { isProtectedBranchTool } from '../src/agents/prompt-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(__dirname, '../src/agents');

describe('agent tool scoping', () => {
  it('tech-lead exports the correct persona name', async () => {
    const { techLead } = await import('../src/agents/tech-lead/agent.js');
    expect(techLead.name).toBe('tech-lead');
  });

  it('tech-lead has two skills loaded from plugin/skills', async () => {
    const base = join(agentsDir, 'tech-lead');
    const skillPaths = await readSkillsDir(personaSkillsDir(base));
    expect(skillPaths.length).toBe(2);
  });

  it('final-code-review allowlist excludes merge and approve tools', () => {
    const allowedTools = getAllowedToolsForTask('final-code-review');

    for (const tool of allowedTools) {
      expect(isProtectedBranchTool(tool)).toBe(false);
    }

    expect(allowedTools).not.toContain('mcp__gitlab__merge_merge_request');
    expect(allowedTools).not.toContain('mcp__gitlab__approve_merge_request');
    expect(allowedTools).not.toContain('mcp__gitlab__merge_request');
    expect(allowedTools).not.toContain('mcp__gitlab__push_file');
    expect(allowedTools).toEqual([...REVIEW_ALLOWED_TOOLS]);
  });

  it('publish-review-summary allowlist excludes GitLab merge tools', () => {
    const allowedTools = getAllowedToolsForTask('publish-review-summary');

    for (const tool of allowedTools) {
      expect(isProtectedBranchTool(tool)).toBe(false);
    }

    expect(allowedTools).not.toContain('mcp__gitlab__merge_merge_request');
    expect(allowedTools).not.toContain('mcp__gitlab__approve_merge_request');
    expect(allowedTools).toEqual([...SUMMARY_ALLOWED_TOOLS]);
  });

  it('final-code-review has read-only GitLab and Jira tools', () => {
    expect(REVIEW_ALLOWED_TOOLS).toContain('mcp__gitlab__get_merge_request');
    expect(REVIEW_ALLOWED_TOOLS).toContain('mcp__gitlab__list_merge_request_diffs');
    expect(REVIEW_ALLOWED_TOOLS).toContain('mcp__atlassian__jira_get_issue');
    expect(REVIEW_ALLOWED_TOOLS).not.toContain('mcp__gitlab__create_note');
    expect(REVIEW_ALLOWED_TOOLS).not.toContain('mcp__atlassian__jira_add_comment');
  });
});
