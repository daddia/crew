import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveCrewDir } from '../../src/evals/config.js';

describe('resolveCrewDir', () => {
  it('resolves crew dir from an eval file path hint', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'crew-config-'));
    const crewDir = join(workspaceRoot, 'crews', 'delivery-build');
    await mkdir(join(crewDir, 'evals'), { recursive: true });

    const hint = join(crewDir, 'evals', 'smoke.eval.ts');
    expect(resolveCrewDir(workspaceRoot, undefined, [hint])).toBe(crewDir);
  });

  it('handles adversarial paths with repeated /evals/ segments without hanging', () => {
    const workspaceRoot = '/tmp/workspace';
    const adversarial = '/evals/'.repeat(5000) + 'file.ts';
    const start = Date.now();
    resolveCrewDir(workspaceRoot, undefined, [adversarial]);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
