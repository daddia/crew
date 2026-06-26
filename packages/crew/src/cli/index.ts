#!/usr/bin/env node
import { initCrew, InitError } from './init.js';
import { parseCliArgs } from './parse-args.js';

const HELP = `Usage: crew init <name> --shape server|cli

Scaffold a new crew under crews/<name>/ in the current workspace.

Options:
  --shape server   Long-lived Hono server with SQLite state (default delivery topology)
  --shape cli      Ephemeral npm package invoked from CI; no persistent state

Examples:
  crew init my-crew --shape server
  npx @daddia/crew init code-reviewer --shape cli
`;

async function main(argv: string[]): Promise<void> {
  const parsed = parseCliArgs(argv);

  if (parsed.command === 'help') {
    process.stdout.write(HELP);
    return;
  }

  const result = await initCrew({
    name: parsed.crewName!,
    shape: parsed.shape!,
  });

  process.stdout.write(
    `Created ${result.shape}-shaped crew at ${result.targetDir}\n` +
      `Pinned @daddia/crew@${result.runtimeVersion}\n` +
      `Next: pnpm install && pnpm --filter @daddia/crew-${parsed.crewName} typecheck\n`,
  );
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof InitError) {
    process.stderr.write(`crew init: ${err.message}\n`);
    process.exit(1);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`crew init: ${message}\n`);
  process.exit(1);
});
