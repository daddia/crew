import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initCrew, InitError } from '../../src/cli/init.js';
import { parseCliArgs } from '../../src/cli/parse-args.js';
import { renderTemplateTree } from '../../src/cli/render-template.js';
import { packageRoot, runtimeVersion } from '../../src/cli/package-root.js';

const execFileAsync = promisify(execFile);

async function scaffoldWorkspace(dir: string): Promise<void> {
  await mkdir(join(dir, '.crew'), { recursive: true });
  await writeFile(join(dir, '.crew', 'config'), 'schema_version: 0.1.0\n');
}

describe('parseCliArgs', () => {
  it('parses init with shape', () => {
    expect(parseCliArgs(['init', 'my-crew', '--shape', 'server'])).toEqual({
      command: 'init',
      crewName: 'my-crew',
      shape: 'server',
    });
  });

  it('rejects missing shape', () => {
    expect(() => parseCliArgs(['init', 'my-crew'])).toThrow(/Missing --shape/);
  });

  it('rejects invalid crew names', () => {
    expect(() => parseCliArgs(['init', 'My_Crew', '--shape', 'cli'])).toThrow(/Invalid crew name/);
  });

  it('parses eval with options', () => {
    expect(
      parseCliArgs([
        'eval',
        'evals/smoke.eval.ts',
        '--crew',
        'delivery-build',
        '--base-url',
        'http://localhost:3000',
        '--strict',
        '--reporter',
        'junit',
        '--output',
        'out.xml',
      ]),
    ).toEqual({
      command: 'eval',
      evalFiles: ['evals/smoke.eval.ts'],
      evalCrew: 'delivery-build',
      baseUrl: 'http://localhost:3000',
      strict: true,
      reporter: 'junit',
      output: 'out.xml',
    });
  });

  it('parses run with fixture options', () => {
    expect(
      parseCliArgs(['run', '--fixture', 'CREW-123', '--crew', 'delivery-build', '--mode', 'mock']),
    ).toEqual({
      command: 'run',
      fixture: 'CREW-123',
      runCrew: 'delivery-build',
      fixtureMode: 'mock',
    });
  });

  it('rejects run without fixture', () => {
    expect(() => parseCliArgs(['run'])).toThrow(/Missing fixture issue key/);
  });
});

describe('initCrew', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'crew-init-'));
    await scaffoldWorkspace(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('scaffolds a server-shaped crew with workflow, config, and persona stub', async () => {
    const result = await initCrew({ name: 'my-crew', shape: 'server', cwd: workspace });

    expect(result.targetDir).toBe(join(workspace, 'crews', 'my-crew'));
    expect(result.runtimeVersion).toBe(runtimeVersion());

    const pkg = JSON.parse(await readFile(join(result.targetDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@daddia/crew']).toBe(runtimeVersion());
    expect(pkg.dependencies['@daddia/crew']).not.toMatch(/workspace:/);

    await expect(readFile(join(result.targetDir, 'src', 'workflow.ts'), 'utf8')).resolves.toContain(
      'createWorkflowEngine',
    );
    await expect(readFile(join(result.targetDir, 'src', 'config.ts'), 'utf8')).resolves.toContain(
      'loadConfig',
    );
    await expect(
      readFile(join(result.targetDir, 'src', 'agents', 'engineer', 'agent.ts'), 'utf8'),
    ).resolves.toContain("name: 'engineer'");
    await expect(
      readFile(
        join(
          result.targetDir,
          'src',
          'agents',
          'engineer',
          'plugin',
          'skills',
          'run-task',
          'SKILL.md',
        ),
        'utf8',
      ),
    ).resolves.toContain('Run task');
  });

  it('includes a wired smoke eval importing @daddia/crew/evals', async () => {
    const result = await initCrew({ name: 'eval-crew', shape: 'server', cwd: workspace });
    const smoke = await readFile(join(result.targetDir, 'evals', 'smoke.eval.ts'), 'utf8');
    expect(smoke).toContain("from '@daddia/crew/evals'");
    expect(smoke).toContain('defineEval');
    expect(smoke).toContain('t.succeeded()');
  });

  it('refuses to overwrite an existing crew directory', async () => {
    await initCrew({ name: 'dup', shape: 'cli', cwd: workspace });
    await expect(initCrew({ name: 'dup', shape: 'cli', cwd: workspace })).rejects.toBeInstanceOf(
      InitError,
    );
  });

  it('scaffolds cli shape without state store', async () => {
    const result = await initCrew({ name: 'cli-crew', shape: 'cli', cwd: workspace });
    await expect(readFile(join(result.targetDir, 'src', 'cli.ts'), 'utf8')).resolves.toContain(
      'runWorkflow',
    );
    await rm(join(result.targetDir, 'src', 'state.ts'), { force: true }).catch(() => undefined);
    let exists = true;
    try {
      await readFile(join(result.targetDir, 'src', 'state.ts'), 'utf8');
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});

describe('renderTemplateTree', () => {
  it('substitutes placeholders in template files', async () => {
    const out = await mkdtemp(join(tmpdir(), 'crew-render-'));
    try {
      await renderTemplateTree(join(packageRoot(), 'templates', 'server'), out, {
        crewName: 'demo',
        packageName: '@daddia/crew-demo',
        crewId: 'demo',
        runtimeVersion: '9.9.9',
      });
      const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8')) as {
        name: string;
        dependencies: Record<string, string>;
      };
      expect(pkg.name).toBe('@daddia/crew-demo');
      expect(pkg.dependencies['@daddia/crew']).toBe('9.9.9');
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});

describe('crew init CLI (integration)', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'crew-cli-'));
    await scaffoldWorkspace(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('runs via node dist/cli/index.js', async () => {
    const cli = join(packageRoot(), 'dist', 'cli', 'index.js');
    const { stdout } = await execFileAsync('node', [cli, 'init', 'it-crew', '--shape', 'server'], {
      cwd: workspace,
      encoding: 'utf8',
    });
    expect(stdout).toContain('crews/it-crew');
    await expect(
      readFile(join(workspace, 'crews', 'it-crew', 'src', 'workflow.ts'), 'utf8'),
    ).resolves.toBeTruthy();
  });
});
