import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { checkProcessEnvInFile } from '../src/rules/process-env.js';
import { checkUpsertBeforeAgentRunContent } from '../src/rules/upsert-before-agent-run.js';
import { checkDuplicateSkillTrees } from '../src/rules/duplicate-skill-trees.js';
import { runInvariantGuard } from '../src/index.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('no-process-env-outside-config', () => {
  it('flags direct process.env key access with rule id and path', async () => {
    const filePath = '/tmp/crews/demo/src/agents/engineer/agent.ts';
    const violations = await checkProcessEnvInFile(
      filePath,
      'const token = process.env.GITLAB_TOKEN;\n',
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe('no-process-env-outside-config');
    expect(violations[0]?.filePath).toBe(filePath);
    expect(violations[0]?.line).toBe(1);
  });

  it('allows bare process.env pass-through', async () => {
    const violations = await checkProcessEnvInFile(
      '/tmp/crews/demo/src/index.ts',
      'export async function boot(env = process.env) {}\n',
    );
    expect(violations).toHaveLength(0);
  });

  it('allows process.env in config.ts', async () => {
    const violations = await checkProcessEnvInFile(
      '/tmp/crews/demo/src/config.ts',
      'const x = process.env.PORT;\n',
    );
    expect(violations).toHaveLength(0);
  });
});

describe('crash-recovery-upsert-before-agent-run', () => {
  it('flags agent.run without preceding upsertStory', () => {
    const content = `
import { engineer } from './agents/engineer/agent.js';

export async function runStory(state: StateStore, issueKey: string) {
  const result = await engineer.run({ issueKey, context: {} });
}
`;
    const violations = checkUpsertBeforeAgentRunContent('/crews/demo/src/workflow.ts', content);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe('crash-recovery-upsert-before-agent-run');
  });

  it('passes when upsertStory precedes agent.run', () => {
    const content = `
import { engineer } from './agents/engineer/agent.js';

export async function runStory(state: StateStore, issueKey: string) {
  state.upsertStory(issueKey, 'implement');
  const result = await engineer.run({ issueKey, context: {} });
}
`;
    const violations = checkUpsertBeforeAgentRunContent('/crews/demo/src/workflow.ts', content);
    expect(violations).toHaveLength(0);
  });
});

describe('no-duplicate-skill-trees', () => {
  it('flags personas with both .claude and plugin skill trees', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'guard-'));
    const persona = join(tempDir, 'demo', 'src', 'agents', 'engineer');
    await mkdir(join(persona, '.claude', 'skills', 'foo'), { recursive: true });
    await mkdir(join(persona, 'plugin', 'skills', 'foo'), { recursive: true });
    await writeFile(join(persona, '.claude', 'skills', 'foo', 'SKILL.md'), '# foo');
    await writeFile(join(persona, 'plugin', 'skills', 'foo', 'SKILL.md'), '# foo');

    const violations = await checkDuplicateSkillTrees(join(tempDir));
    expect(violations.some((v) => v.ruleId === 'no-duplicate-skill-trees')).toBe(true);
  });
});

describe('runInvariantGuard on real repo', () => {
  it('delivery-build at HEAD passes guard:invariants', async () => {
    const repoRoot = join(import.meta.dirname, '..', '..', '..');
    const violations = await runInvariantGuard({ repoRoot });
    const deliveryBuild = violations.filter((v) => v.filePath.includes('delivery-build'));
    expect(deliveryBuild).toEqual([]);
  });
});
