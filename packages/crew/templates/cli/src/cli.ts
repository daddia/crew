import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { log } from './observability.js';
import { runWorkflow } from './workflow.js';

/** CLI entry point — reads context from argv / CI env vars. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const config = loadConfig();
  log.info('cli.start', { crewId: config.identity.crewId });
  const issueKey = argv[0] ?? 'local-run';
  await runWorkflow(issueKey);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((err: unknown) => {
    log.error('cli.fatal', { error: String(err) });
    process.exit(1);
  });
}
