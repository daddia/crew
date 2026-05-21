---
type: Design
scope: work-package
mode: tdd
work_package: crew-diagnostics
epic: CREW-68
version: '0.1'
owner: daddia
status: Draft
last_updated: 2026-05-12
related:
  - AGENTS.md
  - docs/product/product.md
  - docs/product/backlog.md
  - docs/work/crew-cli/design.md
  - packages/crew/package.json
  - crews/delivery-build/src/diagnostics.ts
---

# Design -- Shared diagnostics check library (`@daddia/crew/diagnostics`) (CREW-68)

TDD-mode design for the `crew-diagnostics` work package. There is no parent
`solution.md` for this repository; cross-cutting rules are authoritative in
[`AGENTS.md`](../../../AGENTS.md) and are not repeated here.

## 1. Scope

### 1.1 In scope

| Capability                                                                                                                                                              | Story       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| New `@daddia/crew/diagnostics` subpath exporting `DiagnosticCheck`, `CheckFn`, and `DiagnosticsConfig` types                                                            | CREW-68-001 |
| Built-in check builders: `jiraReachabilityCheck`, `jiraProjectKeyCheck`, `jiraTransitionsCheck`, `gitlabReachabilityCheck`, `mcpServersBootCheck`, `dbDirWritableCheck` | CREW-68-002 |
| `runDiagnosticsChecks(checks)` runner: pure — collects results, no `process.exit`, no output side effects                                                               | CREW-68-001 |
| Version bump `@daddia/crew` to `0.3.0`; update pinned dep in `crews/delivery-build/package.json`                                                                        | CREW-68-003 |
| Migrate `crews/delivery-build/src/diagnostics.ts` to use the package-level check builders; thin remaining `diagnose.config.ts` wires crew-specific config               | CREW-68-004 |
| Unit tests for all built-in check builders in `packages/crew`                                                                                                           | CREW-68-002 |

### 1.2 Out of scope

- The CLI binary (`crew-diagnose`) and output formatting — those live in `crew-cli` (`docs/work/crew-cli/design.md`), which depends on this WP.
- Check builders for integrations not yet used by any crew (e.g. GitHub, Linear, PagerDuty).
- Crew-specific checks (e.g. the exact four Jira transition names `delivery-build` expects) — those remain in each crew's `diagnose.config.ts`.
- Any form of persistent check history or trend reporting.
- Schema validation checks (config validity is already handled by `@daddia/crew/config` at boot).

### 1.3 Capabilities delivered

1. Any crew can import ready-made check builders from `@daddia/crew/diagnostics` without reimplementing fetch logic, MCP spawn, or filesystem probes.
2. The `DiagnosticsConfig` contract lets `crew-cli` load a crew's check configuration file without knowing anything about the crew's internals.
3. The runner is purely functional — it takes an array of check functions and returns an array of results. Side effects (output, exit) are the caller's responsibility.
4. `delivery-build`'s in-crew `diagnostics.ts` is retired; all check logic lives in the package.

## 2. Architecture fit

This work package adds a fourth subpath export to `@daddia/crew`, following
the same pattern as `./config`, `./webhooks`, and the main entry:

| Concern                                                  | Where it lives                             | Source                                               |
| -------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| Subpath export convention                                | `packages/crew/package.json` `exports` map | [`AGENTS.md` "Key packages"](../../../AGENTS.md)     |
| `packages/*` never imports from `crews/*`                | `.dependency-cruiser.cjs`                  | [`AGENTS.md` "Dependency rules"](../../../AGENTS.md) |
| Crew consumes `@daddia/crew` as a published registry dep | `crews/*/package.json`                     | [`AGENTS.md` "MUST"](../../../AGENTS.md)             |

The mental model mirrors the config split from `crew-config`: **`@daddia/crew/diagnostics` owns the mechanism (how to check); each crew's `diagnose.config.ts` owns the policy (what to check and with which parameters).** The runner receives check functions; the check functions receive whatever crew-local context they need at construction time.

The built-in check builders accept a minimal interface (base URL, token, project key) rather than the crew's full `Config` type. This keeps the package free of crew-specific schema knowledge and usable by any future crew regardless of config shape.

## 3. Files and components

### 3.1 New files

```text
packages/crew/
  src/diagnostics/
    index.ts          NEW   public barrel for "@daddia/crew/diagnostics"
    types.ts          NEW   DiagnosticCheck, CheckFn, DiagnosticsConfig
    runner.ts         NEW   runDiagnosticsChecks(checks: CheckFn[]): Promise<DiagnosticCheck[]>
    checks/
      jira.ts         NEW   jiraReachabilityCheck, jiraProjectKeyCheck, jiraTransitionsCheck
      gitlab.ts       NEW   gitlabReachabilityCheck
      mcp.ts          NEW   mcpServersBootCheck (spawn + JSON-RPC initialize handshake)
      fs.ts           NEW   dbDirWritableCheck
  test/diagnostics/
    runner.test.ts    NEW   runner: all pass, partial fail, error propagation
    checks.jira.test.ts   NEW   each check builder: pass, fail (HTTP 4xx), network error
    checks.gitlab.test.ts NEW   gitlab: pass (200), fail (401), network error
    checks.mcp.test.ts    NEW   mcp: injected spawn mock, timeout, spawn error, no servers configured
    checks.fs.test.ts     NEW   fs: writable dir, not writable, non-existent dir

crews/delivery-build/
  src/diagnose.config.ts  NEW   wires crew-specific Config into package-level check builders
```

### 3.2 Evolved files

```text
packages/crew/
  package.json        EVOLVE  add "./diagnostics" subpath export; bump to 0.3.0
  src/index.ts        KEEP    no change (diagnostics is subpath-only)
  tsconfig.json       EVOLVE  include src/diagnostics in compilation

crews/delivery-build/
  src/diagnostics.ts  RETIRE  logic migrated to packages/crew/src/diagnostics/checks/**
  package.json        EVOLVE  bump @daddia/crew to 0.3.0

AGENTS.md             EVOLVE  document @daddia/crew/diagnostics parallel to @daddia/crew/config
```

### 3.3 Files explicitly NOT modified

```text
crews/delivery-build/src/diagnose.ts   # CLI entry; still calls runDiagnosticsChecks via diagnose.config.ts
crews/delivery-build/src/config.ts     # unchanged
crews/delivery-build/src/index.ts      # unchanged
packages/crew/src/{index,config,webhooks,agent,session,hooks,loaders,memory,observability}.ts
```

## 4. Data contracts

### 4.1 Core types (`@daddia/crew/diagnostics`)

```typescript
export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * A zero-argument async function that runs one check and returns its result.
 * Constructed by a check builder that captures all necessary context
 * (credentials, URLs, expected values) at build time.
 */
export type CheckFn = () => Promise<DiagnosticCheck>;

/**
 * The shape a crew's diagnose.config.ts must export as its default export.
 * Loaded dynamically by crew-cli's crew-diagnose binary.
 */
export interface DiagnosticsConfig {
  checks: CheckFn[];
}
```

### 4.2 Runner

```typescript
/**
 * Run all check functions in sequence and return one result per check.
 * Never throws; each check catches its own errors and returns ok: false
 * with the error message as detail.
 */
export async function runDiagnosticsChecks(checks: CheckFn[]): Promise<DiagnosticCheck[]>;
```

### 4.3 Built-in Jira check builders

```typescript
/**
 * Minimal Jira identity needed by the check builders.
 * Accepts a subset of the crew's Config so any crew shape works.
 */
export interface JiraDiagnosticsContext {
  baseUrl: string;
  email: string;
  atlassianApiToken: string;
  projectKey: string;
}

/**
 * Check 1: Jira API reachability.
 * Probes GET /issue/search?jql=ORDER+BY+created+DESC&maxResults=1.
 * Returns the first issue key if found (used by jiraTransitionsCheck).
 */
export function jiraReachabilityCheck(
  ctx: JiraDiagnosticsContext,
  /** Shared mutable ref — populated by this check so transitions check can reuse the result. */
  issueKeyRef?: { current: string | undefined },
): CheckFn;

/**
 * Check 2: Jira project key exists.
 * Probes GET /rest/api/3/project/{projectKey}.
 */
export function jiraProjectKeyCheck(ctx: JiraDiagnosticsContext): CheckFn;

/**
 * Check 3: Required Jira transitions available on the first issue.
 * Reads issueKeyRef.current (populated by jiraReachabilityCheck) at call time.
 */
export function jiraTransitionsCheck(
  ctx: JiraDiagnosticsContext,
  requiredTransitions: string[],
  issueKeyRef: { current: string | undefined },
): CheckFn;
```

### 4.4 Built-in GitLab check builder

```typescript
export interface GitLabDiagnosticsContext {
  apiUrl: string;
  projectId: string;
  gitlabAccessToken: string;
}

/** Check 4: GitLab API reachability. Probes GET /projects/{projectId}. */
export function gitlabReachabilityCheck(ctx: GitLabDiagnosticsContext): CheckFn;
```

### 4.5 Built-in MCP check builder

```typescript
export interface McpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServer>;
}

export interface McpDiagnosticsOptions {
  /** Resolved path to the crew's mcp.json. */
  mcpConfigPath: string;
  /** Current process.env for ${VAR} interpolation in mcp.json env values. */
  env: NodeJS.ProcessEnv;
  /** Override spawn for unit testing. */
  spawnFn?: typeof import('node:child_process').spawn;
  /** Per-server handshake timeout in ms. Default: 10 000. */
  timeoutMs?: number;
}

/**
 * Check 5: MCP server processes boot and respond to JSON-RPC initialize.
 * Reads mcp.json, spawns each server, writes the initialize request to
 * stdin, and waits for any JSON-RPC response on stdout.
 */
export function mcpServersBootCheck(opts: McpDiagnosticsOptions): CheckFn;
```

### 4.6 Built-in filesystem check builder

```typescript
/**
 * Check 6: The directory containing dbPath is writable.
 * Uses fs/promises access(dir, W_OK).
 */
export function dbDirWritableCheck(dbPath: string): CheckFn;
```

### 4.7 Crew wiring (`crews/delivery-build/src/diagnose.config.ts`)

```typescript
import {
  jiraReachabilityCheck,
  jiraProjectKeyCheck,
  jiraTransitionsCheck,
  gitlabReachabilityCheck,
  mcpServersBootCheck,
  dbDirWritableCheck,
  type DiagnosticsConfig,
} from '@daddia/crew/diagnostics';
import { loadConfig } from './config.js';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const config = loadConfig();

const REQUIRED_TRANSITIONS = ['In Progress', 'Clarification Needed', 'In QA', 'Needs human review'];

const issueKeyRef = { current: undefined as string | undefined };

const jiraCtx = {
  baseUrl: config.identity.jira.baseUrl,
  email: config.identity.jira.email,
  atlassianApiToken: String(config.secrets.atlassianApiToken),
  projectKey: config.identity.jira.projectKey,
};

const gitlabCtx = {
  apiUrl: config.identity.gitlab.apiUrl,
  projectId: config.identity.gitlab.projectId,
  gitlabAccessToken: String(config.secrets.gitlabAccessToken),
};

const mcpConfigPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mcp.json');

export default {
  checks: [
    jiraReachabilityCheck(jiraCtx, issueKeyRef),
    jiraProjectKeyCheck(jiraCtx),
    jiraTransitionsCheck(jiraCtx, REQUIRED_TRANSITIONS, issueKeyRef),
    gitlabReachabilityCheck(gitlabCtx),
    mcpServersBootCheck({ mcpConfigPath, env: process.env }),
    dbDirWritableCheck(config.infrastructure.dbPath),
  ],
} satisfies DiagnosticsConfig;
```

## 5. Runtime view

### 5.1 Happy path — all checks pass

1. `crew-cli` (or the crew's `src/diagnose.ts`) dynamic-imports `dist/diagnose.config.js`.
2. `diagnose.config.ts` calls `loadConfig()` at module load time. If config is invalid it throws before any check runs — the config layer already catches this.
3. `runDiagnosticsChecks(config.checks)` runs each `CheckFn` in sequence.
4. Each built-in check makes one deterministic HTTP call (or spawn) and returns `{ name, ok: true, detail }`.
5. The runner returns an array of six `DiagnosticCheck` objects.
6. The caller (CLI or inline script) prints one line per check and exits with 0.

### 5.2 Transitions check after empty search result

1. `jiraReachabilityCheck` runs and the API returns `{ issues: [] }`. It sets `issueKeyRef.current = undefined` and returns `ok: true` (empty result is not a reachability failure).
2. `jiraTransitionsCheck` reads `issueKeyRef.current === undefined` at call time and returns `{ ok: false, detail: "no issues found — cannot probe transitions" }` immediately without an HTTP call.
3. The other checks run normally.

### 5.3 MCP server spawn + handshake

1. `mcpServersBootCheck` reads `mcp.json` and iterates over `mcpServers`.
2. For each server, env values like `${ATLASSIAN_EMAIL}` are resolved against the passed `env` object.
3. `spawn(command, args, { env: merged, stdio: ["pipe", "pipe", "pipe"] })` starts the process.
4. A JSON-RPC `initialize` request is written to `stdin`.
5. The first `data` event on `stdout` containing `"jsonrpc"` or `"result"` marks the check as passed; the process is killed.
6. A 10-second timer kills the process and marks the check as failed if no response arrives.
7. `spawn("error")` or premature `exit` marks the check as failed without waiting for the timer.

### 5.4 Check builder captures context at construction time

Each builder closes over its context object. The returned `CheckFn` is a zero-argument closure. This means:

- The caller constructs all builders (and captures the issueKeyRef) once, then passes the array to `runDiagnosticsChecks`.
- The runner does not need to know anything about credentials, URLs, or the issueKeyRef mechanism.
- Tests can construct check functions with stub contexts without mocking globals.

## 7. Error paths

| Trigger                                       | Check result                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Jira API returns non-2xx                      | `{ ok: false, detail: "GET /... returned HTTP {status}" }`                                       |
| Jira API network error (DNS failure, timeout) | `{ ok: false, detail: String(err) }`                                                             |
| GitLab API returns 401                        | `{ ok: false, detail: "GET /projects/... returned HTTP 401" }`                                   |
| `mcp.json` not found at `mcpConfigPath`       | `{ ok: false, detail: "mcp.json not found at {path}" }`                                          |
| MCP server process exits before handshake     | `{ ok: false, detail: "{name}: process exited with code {n} before handshake" }`                 |
| MCP server handshake timeout                  | `{ ok: false, detail: "{name}: timed out waiting for MCP handshake" }`                           |
| DB directory not writable                     | `{ ok: false, detail: "{dir} is not writable" }`                                                 |
| Any check throws unexpectedly                 | Runner catches and returns `{ ok: false, detail: String(err) }` — the runner itself never throws |

## 8. Observability

No log events, metrics, or trace spans are introduced by this package. The
diagnostics runner is a pure data function; observability is the caller's
responsibility. The `crew-cli` consumer emits one formatted line per result
to stdout.

## 9. Testing strategy

| Layer               | Path                                                   | Scope                                                                                                                                                         | Target                                                               |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Unit (runner)       | `packages/crew/test/diagnostics/runner.test.ts`        | All pass; partial fail; check that throws — runner wraps it; empty checks array returns `[]`                                                                  | 100% line coverage of `runner.ts`                                    |
| Unit (Jira checks)  | `packages/crew/test/diagnostics/checks.jira.test.ts`   | Reachability: 200 ok, 500 fail, network error; project: 200 ok, 404 fail; transitions: all present, one missing, multiple missing, no issueKey available      | All builder + EARS paths exercised; fetch mocked via `vi.stubGlobal` |
| Unit (GitLab check) | `packages/crew/test/diagnostics/checks.gitlab.test.ts` | 200 ok, 401 fail, network error                                                                                                                               | All paths                                                            |
| Unit (MCP check)    | `packages/crew/test/diagnostics/checks.mcp.test.ts`    | `spawnFn` injection: immediate JSON-RPC response, timeout, process exits before response, spawn error, `mcp.json` not found, empty `mcpServers`               | All paths without spawning real processes                            |
| Unit (FS check)     | `packages/crew/test/diagnostics/checks.fs.test.ts`     | Writable dir (mocked `fs.access`), non-writable dir, non-existent parent dir                                                                                  | All three paths                                                      |
| Unit (crew wiring)  | `crews/delivery-build/tests/diagnose.config.test.ts`   | `diagnose.config.ts` exports a `DiagnosticsConfig` with `checks` array of length 6; each check is a function; `loadConfig` is called at module load time      | Type safety + smoke shape assertion                                  |
| Boundary            | `pnpm lint`                                            | `packages/crew/src/diagnostics/**` does not import from `crews/*`; `crews/delivery-build/src/diagnose.config.ts` imports only from `@daddia/crew/diagnostics` | exit 0                                                               |
| Type                | `pnpm typecheck`                                       | `@daddia/crew/diagnostics` resolves; `DiagnosticsConfig` satisfies the type in `diagnose.config.ts`                                                           | exit 0                                                               |

All built-in check builders are tested in `packages/crew/test/diagnostics/` —
not in `crews/delivery-build/tests/`. The in-crew `diagnostics.ts` tests that
currently live at `crews/delivery-build/tests/diagnostics.test.ts` are retired
when `src/diagnostics.ts` is retired.

## 10. Acceptance gates

1. **Subpath export.** `packages/crew/package.json` `exports` map declares `"./diagnostics"` resolving to `./dist/diagnostics/index.js`. `import { runDiagnosticsChecks } from "@daddia/crew/diagnostics"` resolves at typecheck and runtime.
2. **All six built-in builders ship.** `jiraReachabilityCheck`, `jiraProjectKeyCheck`, `jiraTransitionsCheck`, `gitlabReachabilityCheck`, `mcpServersBootCheck`, `dbDirWritableCheck` are exported by the subpath.
3. **Runner never throws.** With a check function that throws synchronously or rejects, `runDiagnosticsChecks` still returns an array of `DiagnosticCheck` where that check has `ok: false` and `detail` contains the error message.
4. **Delivery-build wiring is thin.** `crews/delivery-build/src/diagnose.config.ts` imports only from `@daddia/crew/diagnostics` and `./config.js`. It contains no fetch calls, no spawn calls, and no `process.exit`.
5. **Old diagnostics.ts retired.** `crews/delivery-build/src/diagnostics.ts` is deleted. No import of it exists in the crew.
6. **Boundary unchanged.** `pnpm lint` exits 0; no new dep-cruiser violations.
7. **Existing diagnostics tests pass.** The crew-level `tests/diagnostics.test.ts` (written during CREW-67-001) is replaced or superseded by package-level tests. If retained, it imports from the package, not from `../src/diagnostics.js`.
8. **Version bump propagated.** `@daddia/crew` is published at `0.3.0`. `crews/delivery-build/package.json` pins `"@daddia/crew": "0.3.0"`.
9. **AGENTS.md updated.** `@daddia/crew/diagnostics` is documented in the "Key packages" section with its exported symbols.

## 11. Handoff

### 11.1 Stable when this WP closes

- `@daddia/crew/diagnostics` is the canonical import path for diagnostics check primitives. All future crews build their `diagnose.config.ts` from these builders.
- The `DiagnosticsConfig` contract is fixed: `{ checks: CheckFn[] }`. Any tool that loads this file (REPL, script, CLI) can rely on this shape.
- `delivery-build`'s `diagnose.config.ts` is the reference implementation future crews copy and adapt.

### 11.2 What comes next

- **`crew-cli`** (`docs/work/crew-cli/design.md`) — the `crew-diagnose` binary that discovers and runs a crew's `diagnose.config.js`. Depends on this WP.
- **Additional check builders** — as new integrations are added to future crews (GitHub, Linear, etc.), matching builders ship in minor bumps to `@daddia/crew`.
- **`delivery-build` migration** — the `src/diagnostics.ts` and `tests/diagnostics.test.ts` written during CREW-67-001 are deleted as part of story CREW-68-004.

## 12. Open questions

1. **`issueKeyRef` coupling.** The `jiraReachabilityCheck` / `jiraTransitionsCheck` pair share state via a mutable ref. An alternative is to make transitions check re-run the search internally. The ref approach avoids a duplicate API call but is a subtle side effect. **Owner:** daddia. **Blocks:** CREW-68-002.
2. **MCP JSON-RPC framing.** The current `delivery-build/src/diagnostics.ts` detects any line containing `"jsonrpc"` or `"result"` on stdout. The full MCP protocol uses Content-Length headers (LSP-style) or NDJSON depending on transport version. Verify the actual framing `@anthropic-ai/mcp-server-*` uses before shipping `mcp.ts`. **Owner:** daddia. **Blocks:** CREW-68-002 (mcp check builder only).
3. **Version bump cadence.** Should `crew-diagnostics` and `crew-cli` ship in a single `0.3.0` bump or sequentially (`0.3.0` + `0.4.0`)? A single bump is simpler but requires both WPs to be ready simultaneously. **Owner:** daddia. **Blocks:** neither WP directly, but affects release planning.
4. **`diagnose.config.ts` compile step.** The CLI loads `dist/diagnose.config.js`, which means `pnpm build` must run before `pnpm diagnose`. Should `pnpm diagnose` run `pnpm build` as a prerequisite, or is that the operator's responsibility? **Owner:** daddia. **Blocks:** `crew-cli` design (`docs/work/crew-cli/design.md §12`).
