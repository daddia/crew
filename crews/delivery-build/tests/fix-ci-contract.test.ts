/**
 * RH01-04: fix-ci task must map to a skill and prompt entry; no orphan workflow
 * dispatches for the engineer persona.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readSkillsDir } from '@daddia/crew';
import { parseEngineerArtefacts } from '../src/agents/engineer/agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(__dirname, '../src/agents');
const engineerDir = join(agentsDir, 'engineer');
const PROMPT_PATH = join(engineerDir, 'prompt.md');
const FIX_CI_SKILL_PATH = join(engineerDir, '.claude', 'skills', 'fix-ci', 'SKILL.md');
const WORKFLOW_PATH = join(__dirname, '../src/workflow.ts');

/** Engineer tasks dispatched from workflow.ts (literal `task:` values). */
const WORKFLOW_ENGINEER_TASKS = [
  'assess-clarification',
  'implement-story',
  'address-feedback',
  'fix-ci',
] as const;

/** Context keys workflow passes for fix-ci (see workflow.ts CI monitoring loop). */
const WORKFLOW_FIX_CI_CONTEXT = new Set(['task', 'mrUrl', 'model']);

const FIX_CI_OUTPUT_SAMPLE = JSON.stringify({
  success: true,
  summary: 'Fixed lint failure on MR !42.',
  artefacts: {
    commitsPushed: ['a1b2c3d fix(auth): satisfy eslint no-unused-vars'],
    failureClass: 'lint',
    filesChanged: ['src/auth.ts'],
  },
  costUsd: 0,
});

function parsePromptTaskTable(promptMarkdown: string): Map<string, string> {
  const tasks = new Map<string, string>();
  const tableSection = promptMarkdown.match(/## Tasks you own[\s\S]*?(?=\n## )/)?.[0] ?? '';
  const rowRe = /\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g;

  for (const match of tableSection.matchAll(rowRe)) {
    const task = match[1];
    const skill = match[2];
    if (task === 'context.task' || !task || !skill) continue;
    tasks.set(task, skill);
  }

  return tasks;
}

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

describe('fix-ci contract (RH01-04)', () => {
  it('Gherkin: CI failure dispatches a task the engineer can execute', async () => {
    const [promptMarkdown, skillMarkdown, skillPaths] = await Promise.all([
      readFile(PROMPT_PATH, 'utf8'),
      readFile(FIX_CI_SKILL_PATH, 'utf8'),
      readSkillsDir(join(engineerDir, '.claude', 'skills')),
    ]);

    const promptTasks = parsePromptTaskTable(promptMarkdown);
    expect(promptTasks.get('fix-ci')).toBe('fix-ci');
    expect(skillPaths.some((p) => p.endsWith('fix-ci/SKILL.md'))).toBe(true);

    const required = parseRequiredSkillInputs(skillMarkdown);
    expect(required.has('issueKey')).toBe(true);
    expect(required.get('issueKey')).toBe('input');
    expect(required.has('mrUrl')).toBe(true);
    expect(required.get('mrUrl')).toBe('context');

    for (const [field, source] of required) {
      if (source === 'context') {
        expect(WORKFLOW_FIX_CI_CONTEXT.has(field)).toBe(true);
      }
    }

    const { artefacts, envelopeSuccess } = parseEngineerArtefacts(FIX_CI_OUTPUT_SAMPLE);
    expect(envelopeSuccess).toBe(true);
    expect(artefacts['commitsPushed']).toBeDefined();
    expect(artefacts['failureClass']).toBe('lint');
  });

  it('Gherkin: no orphan task is dispatched for the engineer', async () => {
    const [promptMarkdown, workflowSource, skillDirEntries] = await Promise.all([
      readFile(PROMPT_PATH, 'utf8'),
      readFile(WORKFLOW_PATH, 'utf8'),
      readdir(join(engineerDir, '.claude', 'skills')),
    ]);

    const promptTasks = parsePromptTaskTable(promptMarkdown);
    const skillNames = new Set(skillDirEntries);

    for (const task of WORKFLOW_ENGINEER_TASKS) {
      expect(workflowSource).toContain(`task: '${task}'`);
      expect(promptTasks.has(task)).toBe(true);
      expect(skillNames.has(promptTasks.get(task)!)).toBe(true);
    }

    for (const [task, skill] of promptTasks) {
      expect(skillNames.has(skill)).toBe(true);
      expect(WORKFLOW_ENGINEER_TASKS).toContain(task);
    }
  });
});
