import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seedProjectMemory } from '@daddia/crew';
import { log } from './observability.js';

async function buildSeedContent(projectDir: string): Promise<string> {
  const lines: string[] = ['# Project Memory', '', `Seeded: ${new Date().toISOString()}`, ''];

  try {
    const raw = await readFile(join(projectDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    lines.push('## Language and tooling');
    lines.push('');

    const hasTsconfig = await access(join(projectDir, 'tsconfig.json'))
      .then(() => true)
      .catch(() => false);
    if (hasTsconfig) lines.push('- Language: TypeScript');

    if (typeof pkg['packageManager'] === 'string') {
      const pm = (pkg['packageManager'] as string).split('@')[0] ?? 'unknown';
      lines.push(`- Package manager: ${pm}`);
    }
    const devDeps = (pkg['devDependencies'] ?? {}) as Record<string, unknown>;
    if ('vitest' in devDeps) lines.push('- Test framework: Vitest');
    if ('turbo' in devDeps) lines.push('- Build system: Turborepo');
    lines.push('');
  } catch {
    // package.json not readable; skip section
  }

  try {
    const agentsRaw = await readFile(join(projectDir, 'AGENTS.md'), 'utf8');
    lines.push('## Conventions (from AGENTS.md)');
    lines.push('');
    const agentsLines = agentsRaw.split('\n');
    let cutoff = agentsLines.length;
    for (let i = 30; i < Math.min(agentsLines.length, 80); i++) {
      if (agentsLines[i]?.startsWith('## ')) {
        cutoff = i;
        break;
      }
    }
    lines.push(...agentsLines.slice(0, cutoff));
    lines.push('');
  } catch {
    // Repository guidelines file not readable; skip section
  }

  return lines.join('\n');
}

/**
 * Seed the engineer's project memory file if one does not already exist.
 * Uses delivery-crew-specific content from package metadata and repository guidelines.
 */
export async function seedEngineerMemory(projectDir: string): Promise<void> {
  const content = await buildSeedContent(projectDir);
  const err = await seedProjectMemory(projectDir, 'engineer', content);
  if (err) {
    log.warn('memory.seed-failed', { err: err.message });
  } else {
    log.info('memory.seeded', { persona: 'engineer', projectDir });
  }
}
