---
type: Backlog
scope: work-package
version: '1.0'
owner: daddia
status: Done
last_updated: 2026-05-06
related:
  - docs/product/backlog.md
  - docs/work/crew-config/design.md
  - AGENTS.md
---

# Backlog -- Shared crew config primitives + delivery-build adoption (CREW-65)

Story-level backlog for `docs/work/crew-config/`, implementing CREW-65.

Companion artefacts: `docs/work/crew-config/design.md` · `AGENTS.md` ·
`crews/delivery-build/.env.example`

## 1. Summary

- **Epic.** CREW-65 -- Shared crew config primitives + delivery-build adoption
- **Phase.** Now / Quality
- **Priority.** P1 (reliability: prevents silent misconfig from reaching production)
- **Estimate.** 18 points across 6 stories

**Scope.** Add a `@daddia/crew/config` subpath to `packages/crew` exporting
env-loader, YAML-loader, `Secret` branding, `redact()`, and error primitives.
Wire `crews/delivery-build` as the first consumer: a typed, validated `Config`
read once at boot, threaded explicitly to all consumers, with a provenance log
line and an ESLint rule sealing the boundary.

**Downstream consumers.** Any future crew that needs typed, validated config
copies the `delivery-build` pattern (bucket schema, `loadConfig()`, `ENV_MAPPING`).

**Out of scope (this WP).** Multi-tenant fleet manifests; hot reload; remote
config stores; `crews/delivery-review` migration; schema-version migration
tooling. See `design.md §1.2`.

## 2. Conventions

| Convention | Value |
| --- | --- |
| Epic ID | `CREW-65` |
| Story ID | `CREW-65-{nnn}` |
| Status values | Not started, In progress, In review, Done, Blocked |
| Priority levels | P0 (blocking), P1 (reliability), P2 (quality) |
| Estimation | Fibonacci story points (1, 2, 3, 5, 8) |
| Acceptance format | EARS + Gherkin |

## 3. Stories

---

- [x] **[CREW-65-001] Add `zod` dependency to `packages/crew` and include `src/config` in compilation**
  - **Status:** Done | **Priority:** P0 | **Estimate:** 1
  - **Epic:** CREW-65 | **Labels:** type:dependency
  - **Depends on:** —
  - **Deliverable:** `packages/crew/package.json` lists `zod` as a runtime
    dependency (latest stable `^4.x`). `packages/crew/tsconfig.json` includes
    `src/config/**` in compilation. A minimal `packages/crew/src/config/index.ts`
    barrel exists (may be empty or export a placeholder). `pnpm build` and
    `pnpm typecheck` from the repo root exit 0.
  - **Design:** [`./design.md §3.2`](design.md#32-evolved-files)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL list `zod` in `packages/crew/package.json` `dependencies`
      with a semver range resolving to a published version.
    - WHEN `pnpm build` is run from the repo root, THE SYSTEM SHALL compile
      `packages/crew` including the `src/config/` tree without type errors.
    - WHEN `import { z } from "zod"` is written inside `packages/crew/src/config/`,
      THE SYSTEM SHALL resolve the import at typecheck and runtime.
    - WHEN `pnpm lint` (dependency-cruiser) is run from the repo root, THE
      SYSTEM SHALL exit with code 0 with no boundary violations.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: zod is resolvable inside packages/crew
      Given zod is added to packages/crew/package.json dependencies
      When pnpm install && pnpm build is run from the repo root
      Then the build exits with code 0
      And dist/config/index.js exists under packages/crew
    ```

---

- [x] **[CREW-65-002] Implement `@daddia/crew/config` subpath primitives**
  - **Status:** Done | **Priority:** P0 | **Estimate:** 5
  - **Epic:** CREW-65 | **Labels:** type:feature
  - **Depends on:** CREW-65-001
  - **Deliverable:** Six source files added under `packages/crew/src/config/`:
    `load-env.ts`, `load-yaml.ts`, `redact.ts`, `errors.ts`,
    `detect-workspace.ts`, `index.ts`. The `"./config"` entry is added to the
    `packages/crew/package.json` `exports` map resolving to
    `./dist/config/index.js` / `./dist/config/index.d.ts`. Four test files
    cover each primitive. All EARS statements below hold; all Gherkin scenarios
    pass; `pnpm test`, `pnpm typecheck`, and `pnpm lint` exit 0.
  - **Design:** [`./design.md §3.1`](design.md#31-new-files) and
    [`./design.md §4.1`](design.md#41-shared-primitives-daddiacrewconfig)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL export `loadEnv`, `loadYaml`, `Secret`, `redact`,
      `detectWorkspace`, `formatZodIssues`, `ConfigNotFoundError`, and
      `SchemaValidationError` from `@daddia/crew/config`.
    - WHEN `loadEnv(env, schema, mapping)` is called with a valid env and a
      Zod schema, THE SYSTEM SHALL return the parsed, validated, typed object.
    - WHEN `loadEnv` is called with a missing required field, THE SYSTEM SHALL
      throw `SchemaValidationError` whose `issues` array contains an entry with
      the dot-path of the missing field.
    - WHEN `loadEnv` is called with a coercible numeric string (e.g.
      `"300000"` for a `z.coerce.number()` field), THE SYSTEM SHALL coerce it
      to the target type without error.
    - WHEN `loadYaml(path, schema, label)` is called and the file does not
      exist, THE SYSTEM SHALL throw `ConfigNotFoundError` whose `message`
      includes the path.
    - WHEN `loadYaml` is called and the file contains invalid YAML, THE SYSTEM
      SHALL throw `SchemaValidationError` whose `message` mentions "invalid YAML".
    - WHEN `redact(value)` is called on an object containing a `Secret`-branded
      field, THE SYSTEM SHALL replace that field's value with the string
      `"***"` in the returned object without mutating the input.
    - WHEN `redact(value)` is called on a deeply nested object, THE SYSTEM
      SHALL recurse and replace every `Secret`-branded field at any depth.
    - THE SYSTEM SHALL NOT expose `@daddia/crew/config` exports from the `"."`
      (main) entry point of `@daddia/crew`.
    - WHEN `pnpm lint` (dependency-cruiser) is run, THE SYSTEM SHALL confirm
      that no file under `packages/crew/src/config/` imports from `crews/*`.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: loadEnv parses a valid env into a typed Config slice
      Given a Zod schema with a required string field "identity.jira.projectKey" mapped to "JIRA_PROJECT_KEY"
      And process.env["JIRA_PROJECT_KEY"] = "CREW"
      When loadEnv(env, schema, mapping) is called
      Then the result has identity.jira.projectKey === "CREW"

    Scenario: loadEnv throws SchemaValidationError for a missing required field
      Given a Zod schema with a required string field "identity.jira.projectKey" mapped to "JIRA_PROJECT_KEY"
      And process.env["JIRA_PROJECT_KEY"] is not set
      When loadEnv(env, schema, mapping) is called
      Then SchemaValidationError is thrown
      And err.issues[0].path === "identity.jira.projectKey"

    Scenario: redact replaces Secret-branded values at any depth
      Given a Config object with secrets.anthropicApiKey branded as Secret
      When redact(config) is called
      Then the returned object has secrets.anthropicApiKey === "***"
      And the original config object is unchanged

    Scenario: @daddia/crew/config resolves independently of the main entry
      Given packages/crew is built
      When a TypeScript file imports { loadEnv } from "@daddia/crew/config"
      Then the import resolves without error
      When a TypeScript file imports from "@daddia/crew" (main entry)
      Then loadEnv is not available on that import
    ```

---

- [x] **[CREW-65-003] Add per-crew `ConfigSchema` + `loadConfig()` to `crews/delivery-build`**
  - **Status:** Done | **Priority:** P0 | **Estimate:** 3
  - **Epic:** CREW-65 | **Labels:** type:feature
  - **Depends on:** CREW-65-002
  - **Deliverable:** `crews/delivery-build/src/config.ts` exists containing
    `CONFIG_SCHEMA_VERSION`, `ConfigSchema` (four buckets: `identity`,
    `behaviour`, `infrastructure`, `secrets`), `Config` type, `ENV_MAPPING`,
    and `loadConfig(env?)`. `crews/delivery-build/tests/config.test.ts` covers
    all constraints listed below. `.env.example` is re-grouped to mirror the
    four buckets with inline comments identifying each env var. `README.md`
    points at `src/config.ts` as the schema source of truth. `pnpm test`,
    `pnpm typecheck`, and `pnpm build` exit 0.
  - **Design:** [`./design.md §4.2`](design.md#42-per-crew-schema-crewsdelivery-buildsrcconfigts)
    and [`./design.md §4.3`](design.md#43-env-var-mapping-single-source-of-truth)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL export `ConfigSchema`, `Config`, `CONFIG_SCHEMA_VERSION`,
      and `loadConfig` from `crews/delivery-build/src/config.ts`.
    - WHEN all required env vars are set, THE SYSTEM SHALL return a fully
      typed `Config` with correct values for every field.
    - WHEN any required `identity` or `secrets` field is missing, THE SYSTEM
      SHALL throw `SchemaValidationError` naming the missing field.
    - WHEN `POLL_INTERVAL_MS` is not set, THE SYSTEM SHALL default
      `behaviour.pollIntervalMs` to `300000`.
    - WHEN `REFACTOR_LOOP_CAP` is not set, THE SYSTEM SHALL default
      `behaviour.refactorLoopCap` to `2`.
    - WHEN `CI_RETRY_CAP` is not set, THE SYSTEM SHALL default
      `behaviour.ciRetryCap` to `3`.
    - WHEN `PORT` is not set, THE SYSTEM SHALL default
      `infrastructure.port` to `3000`.
    - WHEN `JIRA_WEBHOOK_SECRET` is set to a string shorter than 16 characters,
      THE SYSTEM SHALL throw `SchemaValidationError` naming
      `secrets.jiraWebhookSecret`.
    - WHEN `ATLASSIAN_BASE_URL` is set to a non-URL string, THE SYSTEM SHALL
      throw `SchemaValidationError` naming `identity.jira.baseUrl`.
    - WHEN `redact(loadConfig())` is called, THE SYSTEM SHALL replace all
      five secret fields with `"***"` and preserve all non-secret fields.
    - THE SYSTEM SHALL NOT read `process.env` anywhere in
      `crews/delivery-build/src/config.ts` except inside `loadConfig()`.
    - THE SYSTEM SHALL update `.env.example` to group env vars under
      `# Identity`, `# Behaviour`, `# Infrastructure`, and `# Secrets` comment
      headers matching the `ConfigSchema` buckets.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: loadConfig returns a valid Config from a complete env
      Given all required env vars are set to valid values
      When loadConfig(env) is called
      Then the result satisfies the ConfigSchema
      And CONFIG_SCHEMA_VERSION equals 1

    Scenario: Missing identity field fails fast
      Given JIRA_PROJECT_KEY is not set in env
      When loadConfig(env) is called
      Then SchemaValidationError is thrown
      And err.issues contains an entry with path "identity.jira.projectKey"

    Scenario: Behaviour defaults applied when optional vars absent
      Given POLL_INTERVAL_MS, REFACTOR_LOOP_CAP, CI_RETRY_CAP, and PORT are not set
      When loadConfig(env) is called with all required fields present
      Then behaviour.pollIntervalMs === 300000
      And behaviour.refactorLoopCap === 2
      And behaviour.ciRetryCap === 3
      And infrastructure.port === 3000

    Scenario: redact replaces all secrets in Config
      Given a valid Config is produced by loadConfig
      When redact(config) is called
      Then all five fields under secrets equal "***"
      And all fields under identity and behaviour are unchanged
    ```

---

- [x] **[CREW-65-004] Thread `Config` explicitly through `crews/delivery-build`**
  - **Status:** Done | **Priority:** P0 | **Estimate:** 5
  - **Epic:** CREW-65 | **Labels:** type:refactor
  - **Depends on:** CREW-65-003
  - **Deliverable:** All eight source files listed below are refactored so
    that `process.env` is no longer read anywhere except `src/config.ts`. The
    `integrations/jira.ts` and `integrations/gitlab.ts` modules become factory
    functions accepting config slices. `poller.ts`, `workflow.ts`, and both
    handlers accept typed slices rather than reading env directly. All existing
    tests are refactored to inject typed `Config` slices instead of mutating
    `process.env`. `pnpm test`, `pnpm typecheck`, and `pnpm lint` exit 0 with
    no previously-passing test now failing.

    Files changed:
    - `src/integrations/jira.ts` — `createJiraClient(identity, secrets)` factory
    - `src/integrations/gitlab.ts` — `createGitlabClient(identity, secrets)` factory
    - `src/poller.ts` — accepts `PollerDeps` (see `design.md §4.4`)
    - `src/workflow.ts` — accepts `WorkflowContext` with `behaviour` slice
    - `src/handlers/jira.ts` — accepts `jiraWebhookSecret` from config
    - `src/handlers/gitlab.ts` — accepts `gitlabWebhookSecret` from config
    - `tests/poller.test.ts` — `process.env` mutation replaced with `Config` injection
    - `tests/handlers.gitlab.test.ts` — same
    - `tests/integrations.jira.test.ts` — same
  - **Design:** [`./design.md §4.4`](design.md#44-factory-signatures-consumers)
    and [`./design.md §5.1`](design.md#51-cold-boot--happy-path)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL NOT contain any `process.env[` or `process.env.` read
      in `crews/delivery-build/src/**` outside `src/config.ts` after this story.
    - WHEN `createJiraClient(identity, secrets)` is called, THE SYSTEM SHALL
      return a client that uses `identity.baseUrl`, `identity.email`, and
      `secrets.atlassianApiToken` for all subsequent Jira API calls.
    - WHEN `createGitlabClient(identity, secrets)` is called, THE SYSTEM SHALL
      return a client that uses `identity.apiUrl` and `secrets.gitlabAccessToken`
      for all subsequent GitLab API calls.
    - WHEN `pollTick` is called with a `PollerDeps` containing a `jira` client
      and `identity.jira.projectKey`, THE SYSTEM SHALL use those values in the
      JQL query rather than reading env vars.
    - WHEN `runStory` is called with a `WorkflowContext` containing a
      `behaviour.refactorLoopCap`, THE SYSTEM SHALL cap the peer-review
      refactor loop at that value.
    - WHEN `pnpm test` is run for `crews/delivery-build`, THE SYSTEM SHALL
      exit 0 and all previously-passing test scenarios shall continue to pass.
    - WHEN `pnpm lint` (dependency-cruiser) is run from the repo root, THE
      SYSTEM SHALL exit 0 with no new boundary violations.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Jira client uses config values, not process.env
      Given a JiraClient created with createJiraClient({ baseUrl: "https://acme.atlassian.net", ... }, secrets)
      When getIssue("CREW-1") is called
      Then the HTTP request targets "https://acme.atlassian.net/rest/api/3/issue/CREW-1"
      And the Authorization header uses the provided atlassianApiToken

    Scenario: Poller uses config identity, not process.env
      Given pollTick is called with PollerDeps containing identity.jira.projectKey = "MYPROJ"
      When the JQL query is formed
      Then it includes 'project = "MYPROJ"'
      And process.env["JIRA_PROJECT_KEY"] was never read

    Scenario: Existing tests pass after process.env mutation is removed
      Given the test suite is run with no process.env setup for JIRA_PROJECT_KEY etc.
      When pnpm test is run for crews/delivery-build
      Then the exit code is 0
      And no test that previously passed now fails
    ```

---

- [x] **[CREW-65-005] Boot-time provenance log and `config.invalid` fast-fail in `index.ts`**
  - **Status:** Done | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-65 | **Labels:** type:observability
  - **Depends on:** CREW-65-004
  - **Deliverable:** `crews/delivery-build/src/index.ts` is updated so that
    `loadConfig()` is called before any other setup. On success, exactly one
    `config.loaded` log line is emitted with the redacted config snapshot. On
    `SchemaValidationError` or `ConfigNotFoundError`, a `config.invalid` log
    line is emitted at error level and `process.exit(1)` is called before the
    Hono server ever binds. A `boot.test.ts` integration test covers both
    paths using a fixture env.
  - **Design:** [`./design.md §5.1`](design.md#51-cold-boot--happy-path),
    [`./design.md §5.2`](design.md#52-cold-boot--misconfig-path),
    [`./design.md §8.1`](design.md#81-log-events)
  - **Acceptance (EARS):**
    - WHEN `loadConfig()` returns successfully, THE SYSTEM SHALL emit exactly
      one structured log line with `event = "config.loaded"`, containing
      `crewId`, `schemaVersion`, and `gitSha` at minimum.
    - WHEN `loadConfig()` returns successfully, THE SYSTEM SHALL NOT include
      any of the five secret field values in the `config.loaded` log payload.
    - WHEN `loadConfig()` throws `SchemaValidationError`, THE SYSTEM SHALL
      emit a structured log line with `event = "config.invalid"` containing
      the `issues` array, then exit with a non-zero code before the Hono
      server begins listening.
    - WHEN `loadConfig()` throws `ConfigNotFoundError`, THE SYSTEM SHALL
      emit `config.invalid` and exit with a non-zero code before binding.
    - WHEN the `config.loaded` log line is emitted, `gitSha` SHALL resolve
      from `RAILWAY_GIT_COMMIT_SHA`, then `GIT_SHA`, then `"unknown"`.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Valid env produces one config.loaded log line
      Given all required env vars are set to valid values
      When the delivery-build process starts
      Then exactly one log line with event "config.loaded" is emitted
      And that log line contains crewId and schemaVersion
      And none of the five secret values appear anywhere in that log line

    Scenario: Missing required var causes exit before server bind
      Given JIRA_PROJECT_KEY is not set
      When the delivery-build process starts
      Then one log line with event "config.invalid" is emitted
      And the log line's issues array contains a path matching "identity.jira.projectKey"
      And the process exits with a non-zero code
      And no HTTP port was bound
    ```

---

- [x] **[CREW-65-006] ESLint rule banning `process.env` outside `config.ts`**
  - **Status:** Done | **Priority:** P2 | **Estimate:** 2
  - **Epic:** CREW-65 | **Labels:** type:quality
  - **Depends on:** CREW-65-004
  - **Deliverable:** `tooling/eslint-config/src/index.ts` (or the appropriate
    shared config file) gains a `no-restricted-syntax` or
    `no-restricted-globals` rule that produces an ESLint error for any
    `process.env` access in files that are not named `config.ts`. The rule is
    documented with a message pointing at `src/config.ts` as the correct
    access point. A self-test in the ESLint config package confirms the rule
    fires on a synthetic fixture and does not fire inside `config.ts`. The rule
    applies to `src/**` in crew packages; `tests/**` is allowed transitionally
    and will be enforced in a follow-on story once all test files are fully
    refactored.
  - **Design:** [`./design.md §3.2`](design.md#32-evolved-files) (tooling/eslint-config)
  - **Acceptance (EARS):**
    - WHEN ESLint is run on a file under `crews/*/src/` that contains
      `process.env["X"]` and is not named `config.ts`, THE SYSTEM SHALL
      report an ESLint error on that access.
    - WHEN ESLint is run on `crews/delivery-build/src/config.ts`, THE SYSTEM
      SHALL NOT report an error for `process.env` access within `loadConfig`.
    - THE SYSTEM SHALL include a human-readable error message on the rule
      directing the author to `src/config.ts`.
    - WHEN `pnpm lint` is run from the repo root after this story, THE SYSTEM
      SHALL exit 0 (no violations in the current codebase, all previous
      `process.env` reads having been removed by CREW-65-004).
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: ESLint flags process.env access outside config.ts
      Given a fixture file at crews/delivery-build/src/poller.ts containing process.env["JIRA_PROJECT_KEY"]
      When ESLint is run on that file
      Then an error is reported on the process.env access
      And the error message contains "config.ts"

    Scenario: ESLint permits process.env access inside config.ts
      Given the file crews/delivery-build/src/config.ts contains process.env access inside loadConfig
      When ESLint is run on that file
      Then no error is reported for process.env access

    Scenario: Repo-wide lint passes after CREW-65-004
      Given CREW-65-004 is complete and all process.env reads outside config.ts are removed
      When pnpm lint is run from the repo root
      Then the exit code is 0
    ```

---

## 4. Traceability

### Stories to design sections

| Story | design.md section |
| --- | --- |
| CREW-65-001 | §3.2 Evolved files (packages/crew package.json, tsconfig) |
| CREW-65-002 | §3.1 New files; §4.1 Shared primitives |
| CREW-65-003 | §4.2 Per-crew schema; §4.3 Env-var mapping |
| CREW-65-004 | §4.4 Factory signatures; §5.1 Runtime view – happy path |
| CREW-65-005 | §5.1 – §5.3 Runtime views; §8.1 Log events |
| CREW-65-006 | §3.2 Evolved files (tooling/eslint-config); §7 Error paths (lint row) |

### Stories to product outcomes

| Story | Product outcome |
| --- | --- |
| CREW-65-001 | Unblocks the primitive library; establishes the `@daddia/crew/config` subpath contract |
| CREW-65-002 | Provides typed, Zod-validated, Secret-branded config primitives reusable by every current and future crew |
| CREW-65-003 | `delivery-build` has a single validated schema; misconfig is now a startup error, not a silent operational failure |
| CREW-65-004 | `process.env` is no longer scattered across 8 source files; tests no longer mutate global state; factory-injected clients are unit-testable without env setup |
| CREW-65-005 | Every deployment emits one structured line answering "what is this process running with?"; bad deploys are rejected by Railway's healthcheck before they serve traffic |
| CREW-65-006 | The `process.env` boundary is enforced by tooling, not just convention; future contributors cannot accidentally bypass `loadConfig` |

## 5. Dependency graph

```text
CREW-65-001  (add zod dep + config barrel)
  +-- CREW-65-002  (primitives: loadEnv, redact, errors, loadYaml, detectWorkspace)
        +-- CREW-65-003  (delivery-build ConfigSchema + loadConfig + .env.example)
              +-- CREW-65-004  (refactor: thread Config through integrations, poller, workflow, handlers)
                    +-- CREW-65-005  (boot provenance log + fast-fail in index.ts)
                    +-- CREW-65-006  (ESLint rule; can start in parallel with 005)
```

Critical path: 001 → 002 → 003 → 004 → 005 (18 points, sequential).
CREW-65-006 can begin as soon as CREW-65-004 is in review.

## 6. Definition of Done

A story in this backlog is done when:

- All EARS statements hold and every Gherkin scenario passes.
- `pnpm typecheck` exits 0 for every package or crew touched.
- `pnpm test` exits 0; no previously-passing test now fails.
- `pnpm lint` (dependency-cruiser) exits 0 from the repo root.
- Code review approved by at least one engineer.
- PR merged into `main`.

## 7. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | `z.ZodBranded` has no runtime representation; `redact()` cannot detect branded fields without an explicit runtime sentinel | High | High | Design §12 OQ-6 resolves this: attach a non-enumerable property in `Secret`'s `transform` at parse time. Settle the implementation approach at the start of CREW-65-002. |
| R2 | The CREW-65-004 test refactor is the largest single chunk of effort; it touches five existing test files and could surface hidden coupling to `process.env` beyond the catalogued files | Medium | Medium | Run a repo-wide `grep -r "process\.env"` inside `crews/delivery-build/src` at the start of CREW-65-004 to enumerate every occurrence before writing the first line of the refactor. |
| R3 | `zod` `z.coerce.number()` silently coerces strings like `"0"` or `"NaN"` to valid numbers; `refactorLoopCap = 0` would disable the peer-review loop | Low | High | Add explicit `z.coerce.number().int().nonnegative()` for caps; add unit tests for boundary values `0`, `1`, and invalid strings in CREW-65-003. |
| R4 | ESLint rule (CREW-65-006) may need per-file overrides if future integration tests legitimately construct envs from scratch; blanket ban in `tests/` deferred | Low | Low | The transitional carve-out for `tests/` (design §12 OQ-4) is the mitigation; tighten to `tests/` in a follow-on story. |

Technical and architecture risks are authoritative in `AGENTS.md` and
`docs/work/crew-config/design.md §12`.

## 8. Handoff

**What this WP leaves stable:**

- `@daddia/crew/config` (`"./config"` subpath) is the import contract for
  typed config primitives. Surface is stable for `@daddia/crew@0.x`;
  additions are non-breaking; removals require a major version bump.
- `Secret(...)` brand and `redact()` are the only sanctioned redaction path
  across all crew code.
- `crews/delivery-build/src/config.ts` is the reference implementation for
  every future crew's config module; its four-bucket structure (`identity` /
  `behaviour` / `infrastructure` / `secrets`) is normative.
- `process.env` is read in exactly one file per crew, enforced by ESLint.
- `.env.example` mirrors the schema bucket-for-bucket and is the authoritative
  human-readable config reference for operators.

**What comes next:**

- `crews/delivery-review/src/config.ts` — when delivery-review gains
  identity-bearing config, follow the same bucketing pattern.
- Multi-tenant fleet manifests — `loadYaml` and `detectWorkspace` primitives
  are already shipped; the fleet layer adds workspace-rooted YAML on top.
- Centralised log-redaction adapter — push `redact()` into `createLogger` so
  structured payloads are implicitly safe; call-site discipline is sufficient
  until then.
