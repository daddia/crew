import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Violation } from '../types.js';

const KEY_ACCESS =
  /process\.env\.[A-Za-z_$][\w$]*|process\.env\[\s*['"][^'"]+['"]\s*\]/g;

async function collectSourceFiles(dir: string, acc: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await collectSourceFiles(full, acc);
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
}

/**
 * Ban direct process.env key reads outside config.ts (mirrors ESLint library config).
 * Bare `process.env` references (e.g. default parameters) are allowed.
 */
export async function checkProcessEnv(crewsDir: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  const files: string[] = [];
  await collectSourceFiles(crewsDir, files);

  for (const filePath of files) {
    if (filePath.endsWith('/config.ts') || filePath.endsWith('\\config.ts')) {
      continue;
    }
    if (!filePath.includes('/src/')) continue;

    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      for (const match of line.matchAll(KEY_ACCESS)) {
        const index = match.index ?? 0;
        violations.push({
          ruleId: 'no-process-env-outside-config',
          filePath,
          line: i + 1,
          message: `Direct process.env key access at column ${index + 1}`,
        });
      }
    }
  }

  return violations;
}

export async function checkProcessEnvInFile(
  filePath: string,
  content: string,
): Promise<Violation[]> {
  if (filePath.endsWith('config.ts')) return [];
  const violations: Violation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const match of line.matchAll(KEY_ACCESS)) {
      violations.push({
        ruleId: 'no-process-env-outside-config',
        filePath,
        line: i + 1,
        message: `Direct process.env key access at column ${(match.index ?? 0) + 1}`,
      });
    }
  }
  return violations;
}
