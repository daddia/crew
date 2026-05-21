import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.turbo']);

function collectDockerfiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      if (!SKIP_DIRS.has(name.name)) out.push(...collectDockerfiles(p));
    } else if (name.name === 'Dockerfile' || name.name.endsWith('.dockerfile')) {
      out.push(p);
    }
  }
  return out;
}

describe('Dockerfile lockfile COPY', () => {
  it('uses explicit pnpm-lock.yaml without a glob suffix in every Dockerfile', () => {
    const dockerfiles = collectDockerfiles(repoRoot);
    expect(dockerfiles.length).toBeGreaterThan(0);

    for (const path of dockerfiles) {
      const content = readFileSync(path, 'utf8');
      expect(content, path).not.toMatch(/pnpm-lock\.yaml\*/);
      expect(content, path).toMatch(/COPY\s+pnpm-lock\.yaml\s+\.\//);
    }
  });
});
