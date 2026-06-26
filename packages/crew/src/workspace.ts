import { cp, mkdir, access } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return stdout.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new WorkspaceError(`git ${args.join(' ')} failed: ${msg}`);
  }
}

/**
 * Copy persona skills and subagent definitions into the target project's
 * `.claude/` tree so the SDK can discover them when `cwd` is the workspace.
 */
export async function syncPersonaClaudeAssets(personaDir: string, projectDir: string): Promise<void> {
  const srcSkills = join(personaDir, '.claude', 'skills');
  const dstSkills = join(projectDir, '.claude', 'skills');
  const srcAgents = join(personaDir, '.claude', 'agents');
  const dstAgents = join(projectDir, '.claude', 'agents');

  await mkdir(dstSkills, { recursive: true });
  await mkdir(dstAgents, { recursive: true });

  try {
    await cp(srcSkills, dstSkills, { recursive: true, force: true });
  } catch {
    // persona has no skills directory
  }

  try {
    await cp(srcAgents, dstAgents, { recursive: true, force: true });
  } catch {
    // persona has no agents directory
  }
}

export interface PrepareWorkspaceOptions {
  /** Feature branch to check out or create from the default branch. */
  branchName?: string;
  /** Default branch to sync before creating a feature branch. Defaults to `main`. */
  defaultBranch?: string;
}

/**
 * Ensure `projectDir` is a git working tree on the requested branch.
 * Fetches and fast-forwards the default branch best-effort before branching.
 */
export async function prepareEngineerWorkspace(
  projectDir: string,
  options: PrepareWorkspaceOptions = {},
): Promise<void> {
  try {
    await access(join(projectDir, '.git'));
  } catch {
    throw new WorkspaceError(`Not a git repository: ${projectDir}`);
  }

  const defaultBranch = options.defaultBranch ?? 'main';

  try {
    await runGit(projectDir, ['fetch', 'origin', '--prune']);
  } catch {
    // offline or no remote — continue with local state
  }

  try {
    await runGit(projectDir, ['checkout', defaultBranch]);
  } catch {
    try {
      await runGit(projectDir, ['checkout', 'master']);
    } catch {
      throw new WorkspaceError(`Could not checkout default branch (${defaultBranch})`);
    }
  }

  try {
    await runGit(projectDir, ['pull', '--ff-only', 'origin', defaultBranch]);
  } catch {
    // best effort
  }

  if (!options.branchName) {
    return;
  }

  const branch = options.branchName;
  try {
    await runGit(projectDir, ['checkout', branch]);
    return;
  } catch {
    // not a local branch yet
  }

  try {
    await runGit(projectDir, ['fetch', 'origin', branch]);
    await runGit(projectDir, ['checkout', '-b', branch, `origin/${branch}`]);
    return;
  } catch {
    // remote branch missing — create from current HEAD (new branch)
  }

  await runGit(projectDir, ['checkout', '-b', branch]);
}

/** Derive SDK skill names from absolute `.../skill-name/SKILL.md` paths. */
export function skillNamesFromPaths(skillPaths: string[]): string[] {
  return skillPaths.map((p) => basename(dirname(p)));
}
