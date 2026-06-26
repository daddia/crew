import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseSubagentFile, buildSdkAgentsMap } from '../src/subagents.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'engineer');
const testRunnerPath = join(fixturesDir, 'plugin', 'agents', 'test-runner.md');

describe('subagent helpers', () => {
  it('parseSubagentFile reads frontmatter name and description', async () => {
    const parsed = await parseSubagentFile(testRunnerPath);
    expect(parsed.name).toBe('test-runner');
    expect(parsed.description).toBe('Runs tests');
    expect(parsed.prompt).toContain('test suite');
  });

  it('buildSdkAgentsMap produces SDK agents keyed by name', async () => {
    const agents = await buildSdkAgentsMap([testRunnerPath]);
    expect(agents['test-runner']).toMatchObject({
      description: 'Runs tests',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
    });
    expect(agents['test-runner']?.prompt).toContain('test suite');
  });
});
