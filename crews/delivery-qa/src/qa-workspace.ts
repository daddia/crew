/**
 * Sandbox QA workspace helpers: checkout MR ref, optional deploy script, test commands.
 */

import { spawn } from 'node:child_process';

export class QaWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QaWorkspaceError';
  }
}

export interface CommandResult {
  exitCode: number;
  output: string;
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function execInDir(cwd: string, command: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(command, args, { cwd, shell: false });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      reject(new QaWorkspaceError(`Failed to spawn ${command}: ${err.message}`));
    });
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Fetch and checkout the MR source branch in the isolated QA workspace.
 */
export async function checkoutMrRef(branchName: string, qaWorkspaceDir: string): Promise<void> {
  const fetch = await execInDir(qaWorkspaceDir, 'git', ['fetch', 'origin', branchName]);
  if (fetch.exitCode !== 0) {
    throw new QaWorkspaceError(
      `git fetch failed: ${fetch.stderr || fetch.stdout || `exit ${fetch.exitCode}`}`,
    );
  }

  const checkout = await execInDir(qaWorkspaceDir, 'git', ['checkout', branchName]);
  if (checkout.exitCode !== 0) {
    throw new QaWorkspaceError(
      `git checkout failed: ${checkout.stderr || checkout.stdout || `exit ${checkout.exitCode}`}`,
    );
  }
}

/**
 * Run an optional deploy hook script relative to the QA workspace root.
 */
export async function runDeployScript(qaWorkspaceDir: string, scriptPath?: string): Promise<void> {
  if (!scriptPath) {
    return;
  }

  const result = await execInDir(qaWorkspaceDir, 'bash', [scriptPath]);
  if (result.exitCode !== 0) {
    throw new QaWorkspaceError(
      `Deploy script failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
    );
  }
}

/**
 * Run a shell test command in the QA workspace and return combined output.
 */
export async function runTestCommand(
  qaWorkspaceDir: string,
  command: string,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(command, [], { cwd: qaWorkspaceDir, shell: true });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      reject(new QaWorkspaceError(`Failed to run test command: ${err.message}`));
    });
    child.on('close', (code) => {
      const output = [stdout, stderr].filter((s) => s.length > 0).join('\n');
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

/** Injectable port for unit tests. */
export interface QaWorkspacePort {
  checkoutMrRef(branchName: string, qaWorkspaceDir: string): Promise<void>;
  runDeployScript(qaWorkspaceDir: string, scriptPath?: string): Promise<void>;
  runTestCommand(qaWorkspaceDir: string, command: string): Promise<CommandResult>;
}

export const defaultQaWorkspace: QaWorkspacePort = {
  checkoutMrRef,
  runDeployScript,
  runTestCommand,
};
