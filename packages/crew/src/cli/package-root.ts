import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the `@daddia/crew` package root (works from `dist/cli/`). */
export function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

/** Published semver of `@daddia/crew` for pinning in scaffolded crews. */
export function runtimeVersion(): string {
  const raw = readFileSync(join(packageRoot(), 'package.json'), 'utf8');
  const parsed = JSON.parse(raw) as { version?: string };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('Could not read @daddia/crew version from package.json');
  }
  return parsed.version;
}
