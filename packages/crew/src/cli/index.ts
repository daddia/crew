#!/usr/bin/env node
import { initCrew, InitError } from './init.js';
import { runEvalCli, EvalCliError } from './eval.js';
import { runStoryCli, RunCliError } from './run.js';
import { parseCliArgs } from './parse-args.js';

const HELP = `Usage:
  crew init <name> --shape server|cli
  crew eval [files...] [options]
  crew run --fixture <issueKey> [options]

Scaffold a new crew under crews/<name>/ in the current workspace, or run CrewBench evals.

Init options:
  --shape server   Long-lived Hono server with SQLite state (default delivery topology)
  --shape cli      Ephemeral npm package invoked from CI; no persistent state

Eval options:
  --crew <name>        Crew under crews/<name>/ (default: infer from file path or cwd)
  --base-url <url>     Crew base URL (default: evals.config.ts or http://localhost:3000)
  --strict             Treat soft assertion failures as gate failures
  --reporter text|junit  Output format (default: text)
  --output <path>      JUnit report path (default: junit.xml)

Run options:
  --fixture <issueKey> Story fixture under crews/<crew>/fixtures/<issueKey>/ (required)
  --crew <name>        Crew package (default: delivery-build when fixtures exist)
  --mode mock|live     Engineer mode (default: mock without ANTHROPIC_API_KEY, else live)

Examples:
  crew init my-crew --shape server
  npx @daddia/crew init code-reviewer --shape cli
  crew eval evals/smoke.eval.ts --base-url http://localhost:3000
  crew eval --crew delivery-build --reporter junit --output eval-results.xml
  crew run --fixture CREW-123 --crew delivery-build --mode mock
`;

async function main(argv: string[]): Promise<void> {
  const parsed = parseCliArgs(argv);

  if (parsed.command === 'help') {
    process.stdout.write(HELP);
    return;
  }

  if (parsed.command === 'init') {
    const result = await initCrew({
      name: parsed.crewName!,
      shape: parsed.shape!,
    });

    process.stdout.write(
      `Created ${result.shape}-shaped crew at ${result.targetDir}\n` +
        `Pinned @daddia/crew@${result.runtimeVersion}\n` +
        `Next: pnpm install && pnpm --filter @daddia/crew-${parsed.crewName} typecheck\n`,
    );
    return;
  }

  if (parsed.command === 'eval') {
    const { exitCode } = await runEvalCli({
      crewName: parsed.evalCrew,
      files: parsed.evalFiles,
      baseUrl: parsed.baseUrl,
      strict: parsed.strict,
      reporter: parsed.reporter,
      output: parsed.output,
    });
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
    return;
  }

  if (parsed.command === 'run') {
    const { exitCode } = await runStoryCli({
      crewName: parsed.runCrew,
      fixture: parsed.fixture!,
      mode: parsed.fixtureMode,
    });
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
    return;
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof InitError) {
    process.stderr.write(`crew init: ${err.message}\n`);
    process.exit(1);
    return;
  }
  if (err instanceof EvalCliError) {
    process.stderr.write(`crew eval: ${err.message}\n`);
    process.exit(1);
    return;
  }
  if (err instanceof RunCliError) {
    process.stderr.write(`crew run: ${err.message}\n`);
    process.exit(1);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`crew: ${message}\n`);
  process.exit(1);
});
