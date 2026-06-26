import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatEvalResult, runEvalSuite } from '@daddia/crew/evals';
import { startEvalServer } from './start-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const crewDir = resolve(__dirname, '../..');

const CI_EVAL_FILES = [
  join(crewDir, 'evals', 'smoke.eval.ts'),
  join(crewDir, 'evals', 'handoff.eval.ts'),
];

async function main(): Promise<void> {
  const server = await startEvalServer();

  try {
    const results = await runEvalSuite({
      crewDir,
      files: CI_EVAL_FILES,
      baseUrl: server.baseUrl,
      strict: true,
    });

    for (const result of results) {
      process.stdout.write(`${formatEvalResult(result)}\n`);
    }

    const failed = results.some((r) => !r.passed);
    if (failed) {
      process.exit(1);
    }
  } finally {
    await server.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`delivery-qa eval:ci failed: ${message}\n`);
  process.exit(1);
});
