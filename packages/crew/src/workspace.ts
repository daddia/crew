import { cp, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PERSONA_PLUGIN_DIR } from './plugins.js';

const execFileAsync = promisify(execFile);

/** Git ref names passed to execFile must not start with `-` (option injection). */
const SAFE_GIT_REF = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

function assertSafeGitRef(ref: string, label: string): void {
  if (!SAFE_GIT_REF.test(ref)) {
    throw new WorkspaceError(`Invalid ${label}: ${ref}`);
  }
}

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
 * Stage a persona plugin bundle inside the workspace `.claude/` tree for
 * offline discovery. Prefer passing absolute `plugins` paths in session
 * options when the SDK host can read the persona bundle directly.
 */
export async function syncPersonaClaudeAssets(
  personaDir: string,
  projectDir: string,
): Promise<void> {
  const srcPlugin = join(personaDir, PERSONA_PLUGIN_DIR);
  const dstPlugin = join(projectDir, '.claude', PERSONA_PLUGIN_DIR);

  await mkdir(dstPlugin, { recursive: true });

  try {
    await cp(srcPlugin, dstPlugin, { recursive: true, force: true });
  } catch {
    // persona has no plugin directory
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
  assertSafeGitRef(defaultBranch, 'default branch');

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
  assertSafeGitRef(branch, 'branch name');
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

/** @deprecated Use namespaced skill names from {@link resolvePluginBundles}. */
export function skillNamesFromPaths(skillPaths: string[]): string[] {
  return skillPaths.map((p) => {
    const parts = p.split('/');
    const skillIdx = parts.lastIndexOf('skills');
    if (skillIdx >= 0 && parts[skillIdx + 1]) {
      return parts[skillIdx + 1]!;
    }
    return parts[parts.length - 2] ?? p;
  });
}
