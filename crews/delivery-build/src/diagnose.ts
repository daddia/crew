/**
 * Pre-flight diagnostics CLI entry point.
 *
 * Loads the runtime config from environment variables, runs all six checks,
 * prints a coloured one-line summary per check, then exits with 0 (all pass)
 * or 1 (any fail).
 *
 * Run with:
 *   pnpm diagnose
 */

import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { runDiagnostics } from "./diagnostics.js";
import { SchemaValidationError, ConfigNotFoundError } from "@daddia/crew/config";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  let config;
  try {
    config = loadConfig(env);
  } catch (err) {
    if (err instanceof SchemaValidationError || err instanceof ConfigNotFoundError) {
      console.error(`${RED}Config invalid: ${err.message}${RESET}`);
      process.exit(1);
      return;
    }
    throw err;
  }

  const checks = await runDiagnostics(config);

  for (const check of checks) {
    const icon = check.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`${icon} ${BOLD}${check.name}${RESET}: ${check.detail}`);
  }

  console.log("");

  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    console.log(`${GREEN}${BOLD}All ${checks.length} checks passed.${RESET}`);
    process.exit(0);
  } else {
    const failedNames = failed.map((c) => c.name).join(", ");
    console.log(
      `${RED}${BOLD}${failed.length} check(s) failed: ${failedNames}${RESET}`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
