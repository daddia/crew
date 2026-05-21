---
type: Design
scope: work-package
mode: tdd
work_package: crew-cli
epic: CREW-69
version: '0.1'
owner: daddia
status: Draft
last_updated: 2026-05-12
related:
  - AGENTS.md
  - docs/product/product.md
  - docs/product/backlog.md
  - docs/work/crew-diagnostics/design.md
  - packages/crew/package.json
  - crews/delivery-build/src/diagnose.ts
---

# Design -- Shared crew CLI (`crew-diagnose` binary) (CREW-69)

TDD-mode design for the `crew-cli` work package. There is no parent
`solution.md` for this repository; cross-cutting rules are authoritative in
[`AGENTS.md`](../../../AGENTS.md) and are not repeated here.

**Depends on:** `crew-diagnostics` (`docs/work/crew-diagnostics/design.md`,
CREW-68) — the `DiagnosticsConfig` type and the check runners this CLI loads
must exist before this binary can be built.

## 1. Scope

### 1.1 In scope

| Capability                                                                                                                                                     | Story       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `crew-diagnose` binary entry point in `packages/crew/package.json` `bin` map                                                                                   | CREW-69-001 |
| Convention-based discovery of a crew's compiled `diagnose.config.js` via `--config` flag (default: `./dist/diagnose.config.js` relative to cwd)                | CREW-69-001 |
| Dynamic import of the config module, extraction of `DiagnosticsConfig.checks`, invocation of `runDiagnosticsChecks`                                            | CREW-69-001 |
| Coloured one-line-per-check output (ANSI codes, `✓` / `✗`) and a final summary line                                                                            | CREW-69-002 |
| Exit code 0 (all pass) / 1 (any fail or config load error)                                                                                                     | CREW-69-001 |
| `pnpm diagnose` script in `crews/delivery-build/package.json` delegates to `crew-diagnose`                                                                     | CREW-69-003 |
| Retire `crews/delivery-build/src/diagnose.ts` (logic is now in the binary)                                                                                     | CREW-69-003 |
| Update `@daddia/crew` to `0.3.0` (or `0.4.0` if diagnostics shipped separately) with the `bin` entry; update pinned dep in `crews/delivery-build/package.json` | CREW-69-004 |
| Unit tests for the output formatter and exit-code logic                                                                                                        | CREW-69-002 |

### 1.2 Out of scope

- Other CLI subcommands beyond `diagnose` (e.g. `crew doctor`, `crew validate`, `crew seed`). The binary name `crew-diagnose` is intentionally verb-first and scoped; a future `crew` umbrella command can wrap it.
- Interactive prompts or watch mode — diagnostics are one-shot.
- `--json` output mode — structured output is a fast-follow once operators ask for it.
- CI integration helpers (GitHub Actions annotations, JUnit XML) — deferred.
- A `@daddia/crew/cli` subpath export. The CLI binary is a `bin` entry only; no programmatic import surface is added for CLI internals.
- Auto-running `pnpm build` before `pnpm diagnose` — the operator is responsible for a prior build step (addressed in §12, open question 1).

### 1.3 Capabilities delivered

1. Any crew can add `"diagnose": "crew-diagnose"` to its `package.json` and get a consistent diagnostics UI without a crew-local `diagnose.ts`.
2. Output format is identical across all crews — operators learn one mental model.
3. Exit code contract is reliable: CI pipelines can gate on `pnpm diagnose` before a deploy.

## 2. Architecture fit

The `crew-diagnose` binary is a thin entry point that glues three existing
surfaces together:

| Surface                | Where it lives                         | This WP's role                                   |
| ---------------------- | -------------------------------------- | ------------------------------------------------ |
| Check library          | `@daddia/crew/diagnostics` (CREW-68)   | Imports `runDiagnosticsChecks`                   |
| Crew check config      | `dist/diagnose.config.js` in each crew | Loads dynamically at runtime                     |
| Crew config validation | `@daddia/crew/config`                  | Loaded by `diagnose.config.ts` before checks run |

The binary does not import from any `crews/*` path. The dependency direction
is:

```
crew-diagnose binary
  → @daddia/crew/diagnostics (runDiagnosticsChecks)
  → [dynamic import] dist/diagnose.config.js
      → @daddia/crew/diagnostics (check builders)
      → ./config.js (crew-specific Config, never seen by the binary)
```

This keeps the binary crew-agnostic. It knows only the `DiagnosticsConfig`
contract — `{ checks: CheckFn[] }` — and nothing about Jira, GitLab, MCP
servers, or any crew-specific type.

## 3. Files and components

### 3.1 New files

```text
packages/crew/
  src/cli/
    diagnose.ts       NEW   crew-diagnose binary entry point
    format.ts         NEW   formatResults(checks, opts): string — pure, no process.exit
  test/cli/
    format.test.ts    NEW   all pass, partial fail, zero checks, ANSI stripping
    diagnose.test.ts  NEW   exit code 0 (all pass), exit code 1 (any fail), config load error, missing config file
```

### 3.2 Evolved files

```text
packages/crew/
  package.json        EVOLVE  add "bin": { "crew-diagnose": "./dist/cli/diagnose.js" }; version bump
  tsconfig.json       EVOLVE  include src/cli in compilation

crews/delivery-build/
  package.json        EVOLVE  "diagnose": "crew-diagnose" (was "node dist/diagnose.js"); bump @daddia/crew pin
  src/diagnose.ts     RETIRE  replaced by crew-diagnose binary
  tests/diagnose.test.ts  RETIRE  (if present; logic now tested in packages/crew/test/cli/)

AGENTS.md             EVOLVE  document the crew-diagnose binary and the diagnose.config.ts convention
```

### 3.3 Files explicitly NOT modified

```text
crews/delivery-build/src/diagnose.config.ts   # written in crew-diagnostics WP; unchanged here
crews/delivery-build/src/config.ts            # unchanged
packages/crew/src/diagnostics/**              # written in crew-diagnostics WP; not touched
packages/crew/src/{index,config,webhooks,...} # unchanged
```

## 4. Data contracts

### 4.1 Binary CLI interface

The binary reads `process.argv` and accepts one optional flag:

```text
crew-diagnose [--config <path>]

  --config <path>   Path to the compiled diagnose.config.js
                    Default: ./dist/diagnose.config.js (relative to cwd)
```

No other flags in this WP. Exit codes:

| Condition                                             | Exit code |
| ----------------------------------------------------- | --------- |
| All checks pass                                       | 0         |
| Any check fails                                       | 1         |
| Config file not found or import throws                | 1         |
| Config file does not export `DiagnosticsConfig` shape | 1         |

### 4.2 Formatter

```typescript
export interface FormatOptions {
  /** Strip ANSI colour codes. Default: false. */
  noColor?: boolean;
}

/**
 * Render a check result array as a human-readable string.
 * Does not write to stdout; does not call process.exit.
 * Suitable for use in tests and non-TTY environments.
 */
export function formatResults(
  checks: import('@daddia/crew/diagnostics').DiagnosticCheck[],
  opts?: FormatOptions,
): string;
```

Output shape produced by `formatResults`:

```text
✓ Jira API reachability: https://acme.atlassian.net is reachable
✓ Jira project key: project CREW exists
✗ Jira transitions: missing transitions: Clarification Needed
✓ GitLab API reachability: https://gitlab.com/api/v4 is reachable
✓ MCP servers boot: all 2 MCP server(s) responded to initialize
✓ DB_PATH directory writable: /data

1 check(s) failed: Jira transitions
```

When all pass, the final line reads: `All N checks passed.`

### 4.3 Binary internals (non-exported)

```typescript
// src/cli/diagnose.ts — not part of any public subpath export

async function main(argv: string[]): Promise<void>;

// Resolves --config flag or default path.
// Dynamic import of the resolved path.
// Calls runDiagnosticsChecks(config.checks).
// Writes formatResults(...) to stdout.
// process.exit(0) or process.exit(1).
```

`main` is exported for unit testing (same pattern as `src/index.ts` in `delivery-build`).

### 4.4 Crew wiring (how a crew opts in)

```json
// crews/{name}/package.json
"scripts": {
  "diagnose": "crew-diagnose"
}
```

With a custom config path:

```json
"diagnose": "crew-diagnose --config dist/diagnose.config.js"
```

The crew still needs `src/diagnose.config.ts` (written in crew-diagnostics WP,
CREW-68-004). No other crew-local file is needed for the CLI path.

## 5. Runtime view

### 5.1 Happy path — `pnpm diagnose` from a crew root

1. pnpm resolves `crew-diagnose` from `node_modules/.bin/crew-diagnose` (installed when `@daddia/crew@0.3.0` is in `dependencies`).
2. Binary starts. `main(process.argv.slice(2))` runs.
3. `--config` is absent; default path `./dist/diagnose.config.js` is resolved relative to `process.cwd()`.
4. `await import(configPath)` loads the compiled config module. The module calls `loadConfig()` at load time — if the config is invalid, this throws immediately (§5.3).
5. `const { checks } = module.default` — shape-checked against `DiagnosticsConfig`.
6. `const results = await runDiagnosticsChecks(checks)` runs all check functions in sequence.
7. `process.stdout.write(formatResults(results))` prints the coloured report.
8. `results.every(r => r.ok)` → `process.exit(0)`. Any `!ok` → `process.exit(1)`.

### 5.2 Any check fails

Same as §5.1 up to step 6. `formatResults` marks failing checks with `✗` in red and includes the failing check names in the summary line. `process.exit(1)`.

### 5.3 Config load error (invalid env or missing file)

1. `await import(configPath)` — the config module calls `loadConfig()` which throws `SchemaValidationError`.
2. The dynamic import rejects. The binary catches the error, prints a short error message to stderr, and exits 1.
3. No check results are printed.

### 5.4 Config file missing

1. `await import(configPath)` throws `ERR_MODULE_NOT_FOUND` (or equivalent).
2. Binary catches, prints `Error: config file not found: {configPath}` to stderr, exits 1.

### 5.5 Non-TTY / CI environment

`formatResults` with default options emits ANSI codes. When `NO_COLOR=1` is set in the environment or when stdout is not a TTY, the binary should suppress colours. Implementation: check `process.env.NO_COLOR` and `process.stdout.isTTY` before passing `noColor: true` to `formatResults`.

## 7. Error paths

| Trigger                                                                        | Binary behaviour                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Config file path not resolvable (typo in `--config`)                           | stderr: `config file not found: {path}`; exit 1                     |
| Config module throws on import (e.g. `loadConfig` fails)                       | stderr: `config load error: {message}`; exit 1                      |
| Config module has no default export                                            | stderr: `config file does not export a DiagnosticsConfig`; exit 1   |
| Config module's default export has no `checks` array                           | stderr: same as above; exit 1                                       |
| One check returns `ok: false`                                                  | Printed with `✗` in output; summary names the failing check; exit 1 |
| All checks pass                                                                | Final line: `All N checks passed.`; exit 0                          |
| `runDiagnosticsChecks` itself throws (should not happen — runner wraps errors) | stderr: `unexpected error: {message}`; exit 1                       |

## 8. Observability

No log events, metrics, or trace spans. The binary writes to stdout/stderr
directly. Operators pipe output to their log aggregator if needed; the exit
code is the machine-readable signal for CI.

## 9. Testing strategy

| Layer                     | Path                                                            | Scope                                                                                                                                                                                                                      | Target                                                                                   |
| ------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Unit (formatter)          | `packages/crew/test/cli/format.test.ts`                         | All pass output; partial fail with summary; zero checks; ANSI present by default; ANSI absent with `noColor: true`; failing check names in summary                                                                         | 100% branch coverage of `format.ts`                                                      |
| Unit (binary main)        | `packages/crew/test/cli/diagnose.test.ts`                       | Exit 0 when all checks pass; exit 1 when any check fails; exit 1 when config file missing; exit 1 when config module throws on import; exit 1 when default export missing `checks`; `--config` flag overrides default path | All EARS paths; `process.exit` spied via `vi.spyOn`; dynamic import mocked via `vi.mock` |
| Integration (crew wiring) | `crews/delivery-build/tests/diagnose-script.test.ts` (optional) | Running `node node_modules/.bin/crew-diagnose --config dist/diagnose.config.js` against a stub config that returns fixed check results exits 0 and prints expected output                                                  | Smoke test: binary resolves in `node_modules/.bin` after `pnpm install`                  |
| Boundary                  | `pnpm lint`                                                     | `packages/crew/src/cli/**` does not import from `crews/*`                                                                                                                                                                  | exit 0                                                                                   |
| Type                      | `pnpm typecheck`                                                | `crew-diagnose` entry resolves; `DiagnosticsConfig` from `@daddia/crew/diagnostics` used in dynamic import check                                                                                                           | exit 0                                                                                   |

## 10. Acceptance gates

1. **Binary resolves.** After `pnpm install` in any crew that depends on `@daddia/crew@0.3.0`, `node_modules/.bin/crew-diagnose` exists and is executable.
2. **`pnpm diagnose` works.** From `crews/delivery-build`, `pnpm diagnose` runs `crew-diagnose`, loads `dist/diagnose.config.js`, executes all six checks, prints a one-line-per-check report, and exits with the correct code.
3. **Exit code contract.** With all checks returning `ok: true`, exit code is 0. With any check returning `ok: false`, exit code is 1. With a missing config file, exit code is 1.
4. **Config error is surfaced.** With a required env var missing (e.g. `JIRA_PROJECT_KEY` unset), `pnpm diagnose` prints a config error to stderr and exits 1 before printing any check results.
5. **Output format.** The check report contains exactly one line per check, each prefixed with `✓` (green) or `✗` (red). The final line is either `All N checks passed.` or `N check(s) failed: {names}`.
6. **Old `diagnose.ts` retired.** `crews/delivery-build/src/diagnose.ts` is deleted. `pnpm typecheck` exits 0 without it.
7. **AGENTS.md updated.** The binary name `crew-diagnose`, the `--config` flag convention, and the `diagnose.config.ts` file shape are documented in AGENTS.md.

## 11. Handoff

### 11.1 Stable when this WP closes

- `crew-diagnose` is the canonical operator command for pre-flight checks across all crews.
- Any new crew adds `"diagnose": "crew-diagnose"` to `scripts` and ships a `src/diagnose.config.ts` using check builders from `@daddia/crew/diagnostics`.
- The output format and exit code contract are stable. CI pipelines can rely on them.

### 11.2 What comes next

- **Additional CLI subcommands.** A future `crew` umbrella command could group `crew diagnose`, `crew seed-memory`, `crew status`, etc. The current `crew-diagnose` binary becomes `crew diagnose` internally, with the standalone `crew-diagnose` kept as an alias.
- **`--json` output mode.** When operators want machine-readable output (CI annotations, Slack webhooks), add a `--json` flag to `formatResults` and `main`. The underlying check results are already structured; no changes to the check library are needed.
- **`delivery-qa` and `delivery-review` adoption.** Both crews gain a `diagnose.config.ts` when they reach their first deployment.
- **Pre-deploy hook.** A Railway or GitHub Actions step runs `pnpm diagnose` against the target environment before the service starts. The exit code gates the deploy.

## 12. Open questions

1. **Build-before-diagnose.** `crew-diagnose` loads `dist/diagnose.config.js`, which requires a prior `pnpm build`. Should `"diagnose": "crew-diagnose"` be changed to `"diagnose": "pnpm build && crew-diagnose"` in each crew's `package.json`? The simpler option is to document the build requirement in the runbook and leave the script thin. **Owner:** daddia. **Blocks:** CREW-69-003.
2. **`NO_COLOR` detection.** Should colour suppression be based solely on `NO_COLOR=1` (explicit operator intent) or also on `!process.stdout.isTTY` (piped output)? CI environments often pipe output but operators may want colour in logs. Recommendation: suppress on either condition; expose `--color` flag to force-enable. **Owner:** daddia. **Blocks:** CREW-69-002.
3. **Version bump: `0.3.0` or `0.4.0`?** If `crew-diagnostics` and `crew-cli` ship simultaneously, both go in `0.3.0`. If sequentially, this WP is `0.4.0`. The `bin` entry cannot land without the `DiagnosticsConfig` type from CREW-68. **Owner:** daddia. **Blocks:** release planning. Cross-reference: `docs/work/crew-diagnostics/design.md §12-3`.
4. **Binary name.** `crew-diagnose` is verbose but unambiguous. If an umbrella `crew` command ships later, `crew diagnose` would be the preferred invocation and `crew-diagnose` becomes a compatibility alias. Flag for future rename. **Owner:** daddia. **Blocks:** nothing now.
