import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  syncPersonaClaudeAssets,
  prepareEngineerWorkspace,
  skillNamesFromPaths,
  WorkspaceError,
} from '../src/workspace.js';

const execFileAsync = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# test\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir });
  await execFileAsync('git', ['branch', '-M', 'main'], { cwd: dir });
}

describe('workspace helpers', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'crew-workspace-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('skillNamesFromPaths derives directory names from SKILL.md paths', () => {
    expect(
      skillNamesFromPaths([
        '/persona/.claude/skills/implement-story/SKILL.md',
        '/persona/.claude/skills/fix-ci/SKILL.md',
      ]),
    ).toEqual(['implement-story', 'fix-ci']);
  });

  it('syncPersonaClaudeAssets copies skills and agents into project .claude', async () => {
    const personaDir = join(tempDir, 'persona');
    const projectDir = join(tempDir, 'project');
    await mkdir(join(personaDir, '.claude', 'skills', 'implement-story'), { recursive: true });
    await mkdir(join(personaDir, '.claude', 'agents'), { recursive: true });
    await writeFile(join(personaDir, '.claude', 'skills', 'implement-story', 'SKILL.md'), '# skill');
    await writeFile(join(personaDir, '.claude', 'agents', 'test-runner.md'), '# agent');
    await mkdir(projectDir, { recursive: true });

    await syncPersonaClaudeAssets(personaDir, projectDir);

    const skill = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(projectDir, '.claude', 'skills', 'implement-story', 'SKILL.md'), 'utf8'),
    );
    expect(skill).toBe('# skill');
    const agent = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(projectDir, '.claude', 'agents', 'test-runner.md'), 'utf8'),
    );
    expect(agent).toBe('# agent');
  });

  it('prepareEngineerWorkspace checks out an existing feature branch', async () => {
    const projectDir = join(tempDir, 'repo');
    await mkdir(projectDir, { recursive: true });
    await initGitRepo(projectDir);
    await execFileAsync('git', ['checkout', '-b', 'feature/CREW-1-foo'], { cwd: projectDir });
    await execFileAsync('git', ['checkout', 'main'], { cwd: projectDir });

    await prepareEngineerWorkspace(projectDir, { branchName: 'feature/CREW-1-foo' });

    const branch = await execFileAsync('git', ['branch', '--show-current'], { cwd: projectDir });
    expect(branch.stdout.trim()).toBe('feature/CREW-1-foo');
  });

  it('prepareEngineerWorkspace creates a new feature branch from main', async () => {
    const projectDir = join(tempDir, 'repo2');
    await mkdir(projectDir, { recursive: true });
    await initGitRepo(projectDir);

    await prepareEngineerWorkspace(projectDir, { branchName: 'feature/CREW-2-bar' });

    const branch = await execFileAsync('git', ['branch', '--show-current'], { cwd: projectDir });
    expect(branch.stdout.trim()).toBe('feature/CREW-2-bar');
  });

  it('throws WorkspaceError when projectDir is not a git repo', async () => {
    const notRepo = join(tempDir, 'plain');
    await mkdir(notRepo, { recursive: true });
    await expect(prepareEngineerWorkspace(notRepo)).rejects.toBeInstanceOf(WorkspaceError);
  });
});
