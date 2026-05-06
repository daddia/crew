---
type: Design
scope: work-package
mode: tdd
work_package: crew-config
epic: CREW-65
version: '0.1'
owner: daddia
status: Draft
last_updated: 2026-05-06
related:
  - AGENTS.md
  - docs/product/backlog.md
  - docs/work/crew-package/design.md
  - crews/delivery-build/.env.example
  - crews/delivery-build/src/index.ts
---

# Design -- Shared crew config primitives + delivery-build adoption (CREW-65)

TDD-mode design for the `crew-config` work package. There is no parent
`solution.md` for this repository; cross-cutting rules are authoritative in
[`AGENTS.md`](../../../AGENTS.md) and are not repeated here.

## 1. Scope

### 1.1 In scope

| Capability | Story (placeholder) |
| --- | --- |
| New `@daddia/crew/config` subpath that exposes loader, validator, secret-redaction, and workspace-detection primitives | CREW-65-001 |
| Add `zod` as a runtime dependency of `packages/crew` and wire the primitive code into the package's build + tests | CREW-65-002 |
| Per-crew `Config` schema and `loadConfig()` for `crews/delivery-build` (the first consumer) | CREW-65-003 |
| Refactor `crews/delivery-build` to thread `Config` explicitly: `index.ts`, `integrations/jira.ts`, `integrations/gitlab.ts`, `poller.ts`, `workflow.ts`, `handlers/jira.ts`, `handlers/gitlab.ts` | CREW-65-004 |
| Boot-time provenance log line + redacted-snapshot helper at the call site | CREW-65-005 |
| ESLint rule banning `process.env` access outside `config.ts` (in `tooling/eslint-config`) | CREW-65-006 |
| Update `crews/delivery-build/.env.example` and `README.md` to mirror the schema buckets | CREW-65-003 |

### 1.2 Out of scope

- Multi-tenant / fleet config. One process per tenant remains the operational unit; fleet manifests are a separate future epic.
- Hot reload or runtime config refresh — config is read once at boot; SIGTERM + redeploy is the change channel.
- Remote config stores (Consul / SSM / Vault). Secrets stay as Railway service variables.
- File-based config delivery for `delivery-build`. The `loadYaml` primitive ships, but `delivery-build` is env-only.
- Migrating `crews/delivery-review` — that crew has no identity-bearing config yet; it adopts the same shape when it does.
- Schema-version migration tooling. The schema gains a `version` constant but no automated migrator.

### 1.3 Capabilities delivered

1. Crews validate every config field at boot; misconfig fails fast and never reaches the request path.
2. Secrets are typed at the schema layer and never appear in logs.
3. One log line at boot answers "what config is this process running with?"
4. Adding a new config field is a single change point inside `crews/{name}/src/config.ts`.
5. `process.env` is accessed in exactly one file per crew; the rest of the code consumes a typed `Config`.

## 2. Architecture fit

This work package extends the shared `@daddia/crew` package with a third entry
point and refactors `crews/delivery-build` to consume it. It does not change
any agent persona, workflow sequence, or webhook contract.

| Concern | Where it lives | Source |
| --- | --- | --- |
| Subpath export pattern (parallel to `./webhooks`) | `packages/crew/package.json` `exports` map | [`AGENTS.md` "Key packages"](../../../AGENTS.md) |
| `crews/* → packages/*` only; never `crews/* → crews/*`; never `packages/* → crews/*` | `.dependency-cruiser.cjs` | [`AGENTS.md` "Dependency rules"](../../../AGENTS.md) |
| Crew-owned state, never shared across crews | Each crew owns its `state.ts` | [`AGENTS.md` "State store conventions"](../../../AGENTS.md) — config follows the same per-crew ownership rule |
| Webhook secrets verified by `verifySignature()` from `@daddia/crew/webhooks` | `crews/delivery-build/src/handlers/*.ts` | [`AGENTS.md` "Webhook handler conventions"](../../../AGENTS.md) — webhook secrets become a `Config` field passed into the verifier |

The mental model: **`@daddia/crew/config` is how config is loaded; the crew's
`config.ts` is what config is.** The shared package owns mechanism; each crew
owns the schema. This mirrors the same split that already exists for webhooks
(shared verification primitives, crew-owned secret values).

## 3. Files and components

### 3.1 New files

```text
packages/crew/
  src/config/
    index.ts              NEW   public barrel for "@daddia/crew/config"
    load-env.ts           NEW   loadEnv<T>(env, schema, mapping)
    load-yaml.ts          NEW   loadYaml<T>(path, schema, label)
    redact.ts             NEW   Secret() brand + redact() walker
    errors.ts             NEW   ConfigNotFoundError, SchemaValidationError, formatZodIssues
    detect-workspace.ts   NEW   walk-up lookup; only used when a crew opts into file-based config
  test/config/
    load-env.test.ts      NEW   coverage for env mapping, defaults, coercion, missing-required
    load-yaml.test.ts     NEW   coverage for ENOENT, invalid YAML, schema mismatch
    redact.test.ts        NEW   secret branding round-trip; nested objects; arrays
    errors.test.ts        NEW   formatZodIssues output stable for snapshot

crews/delivery-build/
  src/config.ts           NEW   ConfigSchema + loadConfig(); the only file that touches process.env
  tests/config.test.ts    NEW   schema validation, defaults, coercion, secret branding
```

### 3.2 Evolved files

```text
packages/crew/
  package.json            EVOLVE  add "./config" subpath export; add "zod" runtime dep
  src/index.ts            KEEP    no change (config is subpath-only, like ./webhooks)
  tsconfig.json           EVOLVE  include src/config in compilation

crews/delivery-build/
  src/index.ts                EVOLVE  call loadConfig() at boot; pass slices into createStateStore, startPoller, handlers; emit "config.loaded" log
  src/integrations/jira.ts    EVOLVE  replace module-level env reads with createJiraClient(jiraIdentity, secrets) factory
  src/integrations/gitlab.ts  EVOLVE  same factory pattern
  src/poller.ts               EVOLVE  accept { identity, behaviour, jira } slice; remove process.env reads
  src/workflow.ts             EVOLVE  accept { behaviour } slice; remove parseInt(process.env) reads
  src/handlers/jira.ts        EVOLVE  accept jiraWebhookSecret from config
  src/handlers/gitlab.ts      EVOLVE  accept gitlabWebhookSecret from config
  .env.example                EVOLVE  re-grouped by Identity / Behaviour / Infrastructure / Secrets
  README.md                   EVOLVE  point at src/config.ts as the schema source of truth

tooling/eslint-config/
  src/index.ts            EVOLVE  add no-process-env-outside-config rule (or override of no-restricted-properties)

AGENTS.md                 EVOLVE  add @daddia/crew/config to the "Key packages" section parallel to /webhooks
```

### 3.3 Files explicitly NOT modified

```text
crews/delivery-build/src/state.ts                                                # already takes DB_PATH at construction
crews/delivery-build/src/observability.ts                                         # logger creation unchanged
crews/delivery-build/src/agents/**                                                # personas read no env directly
crews/delivery-build/src/memory.ts                                                # PROJECT_DIR threaded via Config in CREW-65-004
crews/delivery-build/src/idempotency.ts                                           # singleton lazy-initialised; no env reads
crews/delivery-review/**                                                           # out of scope this WP
packages/crew/src/{agent,unit,session,hooks,loaders,memory,observability,webhooks}.ts  # unchanged
```

## 4. Data contracts

### 4.1 Shared primitives (`@daddia/crew/config`)

```typescript
import { z, type ZodSchema, type ZodError } from "zod";

export const SECRET_BRAND: unique symbol;

export type Secret<T extends z.ZodTypeAny> = z.ZodBranded<T, typeof SECRET_BRAND>;

export function Secret<T extends z.ZodTypeAny>(inner: T): Secret<T>;

export function redact<T>(value: T): T;

export type EnvMapping = Record<string, string>;

export function loadEnv<T>(
  env: NodeJS.ProcessEnv,
  schema: ZodSchema<T>,
  mapping: EnvMapping,
): T;

export function loadYaml<T>(
  filePath: string,
  schema: ZodSchema<T>,
  label: string,
): Promise<T>;

export function detectWorkspace(startDir: string): string;

export function formatZodIssues(err: ZodError): string;

export class ConfigNotFoundError extends Error {
  readonly code: "CONFIG_NOT_FOUND";
}

export class SchemaValidationError extends Error {
  readonly code: "SCHEMA_VALIDATION";
  readonly issues: ReadonlyArray<{ path: string; message: string }>;
}
```

### 4.2 Per-crew schema (`crews/delivery-build/src/config.ts`)

```typescript
import { z } from "zod";
import { Secret, loadEnv } from "@daddia/crew/config";

export const CONFIG_SCHEMA_VERSION = 1 as const;

export const ConfigSchema = z.object({
  identity: z.object({
    crewId: z.string().min(1),
    jira: z.object({
      baseUrl: z.string().url(),
      email: z.string().email(),
      projectKey: z.string().min(1),
      assigneeAccountId: z.string().min(1),
    }),
    gitlab: z.object({
      apiUrl: z.string().url(),
      projectId: z.string().min(1),
    }),
  }),
  behaviour: z.object({
    pollIntervalMs: z.coerce.number().int().positive().default(300_000),
    refactorLoopCap: z.coerce.number().int().nonnegative().default(2),
    ciRetryCap: z.coerce.number().int().nonnegative().default(3),
    ciPollIntervalMs: z.coerce.number().int().positive().default(30_000),
    clarificationTimeoutHours: z.coerce.number().int().positive().default(24),
    anthropicModel: z.string().min(1).optional(),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }),
  infrastructure: z.object({
    port: z.coerce.number().int().positive().default(3000),
    dbPath: z.string().min(1),
    projectDir: z.string().min(1),
  }),
  secrets: z.object({
    anthropicApiKey: Secret(z.string().min(1)),
    atlassianApiToken: Secret(z.string().min(1)),
    gitlabAccessToken: Secret(z.string().min(1)),
    jiraWebhookSecret: Secret(z.string().min(16)),
    gitlabWebhookSecret: Secret(z.string().min(16)),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env?: NodeJS.ProcessEnv): Config;
```

### 4.3 Env-var mapping (single source of truth)

```typescript
const ENV_MAPPING: EnvMapping = {
  "identity.crewId":                       "CREW_ID",
  "identity.jira.baseUrl":                 "ATLASSIAN_BASE_URL",
  "identity.jira.email":                   "ATLASSIAN_EMAIL",
  "identity.jira.projectKey":              "JIRA_PROJECT_KEY",
  "identity.jira.assigneeAccountId":       "JIRA_ASSIGNEE_ACCOUNT_ID",
  "identity.gitlab.apiUrl":                "GITLAB_API_URL",
  "identity.gitlab.projectId":             "GITLAB_PROJECT_ID",
  "behaviour.pollIntervalMs":              "POLL_INTERVAL_MS",
  "behaviour.refactorLoopCap":             "REFACTOR_LOOP_CAP",
  "behaviour.ciRetryCap":                  "CI_RETRY_CAP",
  "behaviour.ciPollIntervalMs":            "CI_POLL_INTERVAL_MS",
  "behaviour.clarificationTimeoutHours":   "CLARIFICATION_TIMEOUT_HOURS",
  "behaviour.anthropicModel":              "ANTHROPIC_MODEL",
  "behaviour.logLevel":                    "LOG_LEVEL",
  "infrastructure.port":                   "PORT",
  "infrastructure.dbPath":                 "DB_PATH",
  "infrastructure.projectDir":             "PROJECT_DIR",
  "secrets.anthropicApiKey":               "ANTHROPIC_API_KEY",
  "secrets.atlassianApiToken":             "ATLASSIAN_API_TOKEN",
  "secrets.gitlabAccessToken":             "GITLAB_PERSONAL_ACCESS_TOKEN",
  "secrets.jiraWebhookSecret":             "JIRA_WEBHOOK_SECRET",
  "secrets.gitlabWebhookSecret":           "GITLAB_WEBHOOK_SECRET",
};
```

### 4.4 Factory signatures (consumers)

```typescript
export function createJiraClient(
  identity: Config["identity"]["jira"],
  secrets: Pick<Config["secrets"], "atlassianApiToken">,
): JiraClient;

export function createGitlabClient(
  identity: Config["identity"]["gitlab"],
  secrets: Pick<Config["secrets"], "gitlabAccessToken">,
): GitlabClient;

export interface PollerDeps {
  identity: Config["identity"];
  behaviour: Pick<Config["behaviour"], "pollIntervalMs" | "clarificationTimeoutHours">;
  jira: JiraClient;
}
export function startPoller(deps: PollerDeps, state: StateStore): NodeJS.Timeout;

export interface WorkflowContext {
  issueKey: string;
  state: StateStore;
  behaviour: Pick<Config["behaviour"], "refactorLoopCap" | "ciRetryCap" | "ciPollIntervalMs">;
  jira: JiraClient;
  gitlab: GitlabClient;
}
```

## 5. Runtime view

Three flows cover the design.

### 5.1 Cold boot — happy path

1. Process starts. `crews/delivery-build/src/index.ts` calls `loadConfig()`.
2. `loadConfig()` reads `process.env`, applies `ENV_MAPPING` to project flat keys into the nested shape, then calls `ConfigSchema.parse()`.
3. Zod validates: required fields present, defaults applied, secrets receive the `Secret` brand.
4. `index.ts` constructs the dependency graph from the typed `Config`:
   - `state = createStateStore(config.infrastructure.dbPath)`
   - `jira = createJiraClient(config.identity.jira, { atlassianApiToken: config.secrets.atlassianApiToken })`
   - `gitlab = createGitlabClient(config.identity.gitlab, { gitlabAccessToken: config.secrets.gitlabAccessToken })`
   - `startPoller({ identity: config.identity, behaviour: config.behaviour, jira }, state)`
   - Hono routes mount handlers wired to `config.secrets.jiraWebhookSecret` and `config.secrets.gitlabWebhookSecret`.
5. `log.info("config.loaded", { crewId, schemaVersion: CONFIG_SCHEMA_VERSION, gitSha, ...redact(config) })` — one line, no secrets.
6. Hono server begins listening on `config.infrastructure.port`.

### 5.2 Cold boot — misconfig path

1. Operator forgets `JIRA_PROJECT_KEY` (or supplies a 6-char `JIRA_WEBHOOK_SECRET`).
2. `ConfigSchema.parse()` throws a `ZodError`.
3. `loadConfig()` catches, calls `formatZodIssues(err)`, throws `SchemaValidationError` with the formatted issues.
4. Top-level `try`/`catch` in `index.ts` logs `config.invalid` at error level with the issues array, then `process.exit(1)`.
5. The Hono server is **never started**. Railway's healthcheck never goes green; the previous deployment stays in rotation.

### 5.3 Provenance and accidental-leak path

1. Any structured log call that takes a `Config` (or slice) MUST go through `redact()` at the call site. Convention enforced by review.
2. `redact()` walks the value, detects `Secret`-branded fields by their runtime sentinel attached at parse time, and replaces them with `"***"`.
3. Operator runs `railway logs --tail | jq 'select(.event == "config.loaded")'` to see one record per restart. Fields include `crewId`, `gitSha`, `schemaVersion`, project keys, intervals, caps. No tokens.

## 6. Cross-squad coordination

Not applicable — single crew, single owner.

## 7. Error paths

All config errors terminate the process at boot. There is no fallback mode,
no "best-effort" degraded operation, and no per-field default for `Secret`s
or `identity` fields.

| Trigger | Error class | Handling | Log event |
| --- | --- | --- | --- |
| Required env var missing | `SchemaValidationError` | `process.exit(1)` before bind | `config.invalid` (error) |
| Env var has unparseable type (e.g. `POLL_INTERVAL_MS=fast`) | `SchemaValidationError` | `process.exit(1)` before bind | `config.invalid` (error) |
| Webhook secret < 16 chars | `SchemaValidationError` | `process.exit(1)` before bind | `config.invalid` (error) |
| `ATLASSIAN_BASE_URL` not a valid URL | `SchemaValidationError` | `process.exit(1)` before bind | `config.invalid` (error) |
| YAML config file missing (when a future crew opts in to file mode) | `ConfigNotFoundError` | `process.exit(1)` before bind | `config.not-found` (error) |
| Code attempts to log a `Config` slice without `redact()` | n/a (lint) | ESLint rule blocks merge | n/a |
| Code reads `process.env` outside `config.ts` | n/a (lint) | ESLint rule blocks merge | n/a |

The `formatZodIssues()` helper produces a stable, multi-line string of the form:

```text
identity.jira.projectKey: Required
identity.jira.assigneeAccountId: Required
secrets.jiraWebhookSecret: String must contain at least 16 character(s)
```

This format is stable across releases so on-call dashboards can match on it.

## 8. Observability

This work package adds two log events; no metrics, no trace spans. Config is
a one-shot at boot — there is nothing to measure over time.

### 8.1 Log events

| Event | Level | When | Fields |
| --- | --- | --- | --- |
| `config.loaded` | info | once, after `loadConfig()` returns successfully | `crewId`, `schemaVersion`, `gitSha`, `identity.*`, `behaviour.*`, `infrastructure.*`. Secrets replaced with `"***"`. |
| `config.invalid` | error | once, on `SchemaValidationError` or `ConfigNotFoundError` | `code`, `issues` (array of `{path, message}`), `pid` |

`gitSha` resolves from the first defined of: `RAILWAY_GIT_COMMIT_SHA`,
`GIT_SHA`, or `"unknown"`. Both events use the existing `createLogger`
helper from `@daddia/crew` (see `crews/delivery-build/src/observability.ts`).

### 8.2 Redaction discipline

`redact()` is the only sanctioned redaction primitive. It is invoked at the
call site that builds the structured log payload, never inside the logger
itself, so the typed `Config` cannot accidentally bypass it. The `Secret`
brand survives `JSON.stringify` because it is attached as a runtime
property (not just a TypeScript brand) — `redact()` uses that runtime
marker rather than relying on Zod metadata at log time.

## 9. Testing strategy

| Layer | Path | Scope | Target |
| --- | --- | --- | --- |
| Unit (primitives) | `packages/crew/test/config/` | Each primitive in isolation: `loadEnv` mapping + coercion + defaults; `loadYaml` ENOENT, parse error, schema mismatch; `redact` recursion across nested objects, arrays, `Secret`-branded strings; `formatZodIssues` snapshot stability; `detectWorkspace` walk-up termination. | 100% line coverage of `packages/crew/src/config/**`; every error branch exercised |
| Unit (per-crew schema) | `crews/delivery-build/tests/config.test.ts` | Required-field absence -> `SchemaValidationError`; default applied when env unset; coercion of numeric strings; secret-length minimum; URL validation; idempotent `loadConfig()` calls return distinct instances. | One test per Zod constraint; explicit assertion that no secret value appears in `redact(config)` |
| Integration (boot path) | `crews/delivery-build/tests/boot.test.ts` (NEW) | With a fixture env, assert: state store opened with the expected `dbPath`, poller registered with the expected interval, server listening on the expected port, `config.loaded` log emitted exactly once. | One success fixture, one misconfig fixture (exits 1, emits `config.invalid`) |
| Integration (refactor parity) | `crews/delivery-build/tests/{poller,handlers.*,workflow,integrations.*}.test.ts` | Existing tests refactored: replace `process.env` mutation with constructed `Config` injected through factory functions. | Net no behaviour change; same suite passes; `process.env` mutation removed from test code |
| Lint | `tooling/eslint-config` self-test | Synthetic `process.env["x"]` access in a fixture file outside `config.ts` produces an ESLint error matching `no-process-env-outside-config`. | Rule fires; rule does not fire inside `config.ts` |
| Type | `pnpm typecheck` from repo root | Subpath import `@daddia/crew/config` resolves; `Config` type fully inferred from Zod schema; `Secret(z.string())` extends `z.ZodString`. | exit 0 |
| Boundary | `pnpm lint` (dependency-cruiser) | New `packages/crew/src/config/**` files do not import from `crews/*`; new `crews/delivery-build/src/config.ts` imports only from `@daddia/crew/config`. | exit 0 |

The test refactor is the largest single chunk of effort. The current tests in
`crews/delivery-build/tests/` mutate `process.env` between cases (see
`tests/poller.test.ts`, `tests/handlers.gitlab.test.ts`,
`tests/integrations.jira.test.ts`); under this design they construct typed
`Config` slices and inject them, eliminating env mutation entirely.

## 10. Acceptance gates

The gates this work package must clear (no `solution.md §2.1` to inherit
from; gates are derived from `AGENTS.md` and §1–§9 above):

1. **Subpath export.** `packages/crew/package.json` `exports` map declares
   `"./config"` resolving to `./dist/config/index.js`.
   `import { loadEnv } from "@daddia/crew/config"` resolves at typecheck
   and runtime.
2. **Single boundary.** No occurrence of `process.env` exists in
   `crews/delivery-build/src/**` outside `crews/delivery-build/src/config.ts`.
   Verified by ESLint rule and a dedicated unit test that scans the source
   tree.
3. **Fail-fast on misconfig.** With `JIRA_PROJECT_KEY` unset (or any required
   field missing), `pnpm start` from `crews/delivery-build` exits non-zero
   before the Hono server begins listening. The log line `config.invalid`
   contains the offending Zod path (`identity.jira.projectKey`).
4. **Provenance log.** With a valid env, `pnpm start` emits exactly one
   `config.loaded` log at boot. The payload contains `crewId`,
   `schemaVersion`, `gitSha`, and all non-secret fields. No secret value
   appears in any log payload (verified by integration-test assertion that
   greps the captured log stream).
5. **Boundary unchanged.** `pnpm lint` (dependency-cruiser) exits 0; no
   `crews/* -> crews/*` or `packages/* -> crews/*` violation is introduced.
6. **Behaviour parity.** All previously-passing tests in
   `crews/delivery-build/tests/` continue to pass after refactor. No new
   Jira webhook, GitLab webhook, or workflow scenario behaves differently.
7. **AGENTS.md updated.** The "Key packages" section documents
   `@daddia/crew/config` parallel to `@daddia/crew/webhooks`, with the
   exported symbols listed.
8. **Schema-version constant.** `CONFIG_SCHEMA_VERSION` is a `const` in
   `crews/delivery-build/src/config.ts`. Future schema-breaking changes are
   gated on bumping it.

## 11. Handoff

### 11.1 Stable when this WP closes

- `@daddia/crew/config` is the import contract for typed config primitives
  across all current and future crews. Its surface is fixed for the lifetime
  of `@daddia/crew@0.x` — additions are non-breaking; removals require a
  major bump.
- `Secret(...)` brand and `redact()` are the only sanctioned redaction path;
  ad-hoc redaction is forbidden by review.
- `crews/delivery-build/src/config.ts` is the **reference implementation**
  the next crew copies. Its bucket structure (`identity` /
  `behaviour` / `infrastructure` / `secrets`) is normative.
- `process.env` is read in exactly one file per crew; the rule is enforced
  by ESLint.
- The `.env.example` for `delivery-build` mirrors the schema bucket-for-bucket
  and serves as human-readable schema documentation.

### 11.2 What comes next

- **`crews/delivery-review/src/config.ts`** — when delivery-review gains
  identity-bearing config (Jira project, GitLab project), follow the same
  bucketing.
- **Multi-tenant fleet** — if/when one process needs to serve N tenants, add
  a workspace-rooted YAML layer using the already-shipped `loadYaml` and
  `detectWorkspace` primitives. No new shared package work required at that
  point.
- **Centralised log-redaction adapter** — push `redact()` into the
  `createLogger` adapter so any structured payload is implicitly safe. Out
  of scope here; the call-site discipline is sufficient until then.
- **Provider-allowlist for `anthropicModel`** — port v1's `allowed_models`
  pattern (see `crew-v1/packages/crew/src/config/schemas.ts`, `LlmConfigSchema`)
  if/when we want operational guard-rails on which model an operator can
  point a crew at.
- **CI lint for schema drift** — verify `CONFIG_SCHEMA_VERSION` matches the
  shape of `ConfigSchema` (e.g. via JSON-schema export + checked-in snapshot).

## 12. Open questions

1. **Epic ID ratification.** This design uses `65` as a placeholder; the
   epic does not yet exist in `docs/product/backlog.md`. **Owner:** daddia.
   **Blocks:** story creation in `docs/work/crew-config/backlog.md`.
   Recommended resolution: write the backlog as the next step in this WP.
2. **`zod` runtime cost.** `zod` adds approximately 50 KB to the bundled
   `packages/crew` output. Acceptable for a server-side library; flagged for
   visibility. **Owner:** daddia. **Blocks:** nothing — go-ahead implied
   unless raised.
3. **`ANTHROPIC_MODEL` allowlist.** v1's `LlmConfigSchema` allowlists model
   aliases via `allowed_models`. Should `delivery-build` adopt the same?
   Recommendation: not in this WP (defer to a follow-on); accept any string
   the SDK accepts. **Owner:** daddia. **Blocks:** nothing P0.
4. **ESLint rule scope -- `tests/` directory.** Should the `process.env` ban
   apply to `tests/` too, or only to `src/`? Recommendation: ban in `src/`,
   allow transitionally in `tests/` until the refactor completes
   (CREW-65-004), then ban in `tests/` as well. **Owner:** daddia.
   **Blocks:** CREW-65-006.
5. **Boot-time secret presence vs validity.** Schema validates *presence* and
   *length* of secrets but cannot validate *correctness* (the Atlassian
   token could be syntactically valid but revoked). Should boot perform a
   no-op authenticated probe against Jira and GitLab to fail fast on bad
   credentials? Recommendation: not in this WP; the first poll tick
   surfaces the failure within `pollIntervalMs`. **Owner:** daddia.
   **Blocks:** nothing P0.
6. **Secret brand at runtime.** `z.ZodBranded` is purely structural in
   TypeScript and disappears at runtime. `redact()` therefore needs a
   runtime marker. Two options: (a) attach a non-enumerable property in
   the `Secret` factory's `transform`; (b) keep the schema and pair it with
   a parallel `Set<string>` of secret paths. Option (a) is more
   self-contained; (b) is simpler. Recommendation: (a). **Owner:** daddia.
   **Blocks:** CREW-65-001.
