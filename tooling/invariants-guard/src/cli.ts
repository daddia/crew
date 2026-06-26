#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatViolation, runInvariantGuard } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

const violations = await runInvariantGuard({ repoRoot });

if (violations.length === 0) {
  process.stdout.write('guard:invariants — all checks passed\n');
  process.exit(0);
}

for (const v of violations) {
  process.stderr.write(`${formatViolation(v, repoRoot)}\n`);
}
process.stderr.write(`guard:invariants — ${violations.length} violation(s)\n`);
process.exit(1);
