---
type: Design
scope: work-package
mode: walking-skeleton
work_package: workspace-config
epic: TBD
version: '0.1'
owner: daddia
status: Draft
last_updated: 2026-05-24
related:
  - ../../architecture/solution.md
  - ../../architecture/principles.md
  - ../../product/backlog.md
---

# Design -- Workspace Config (`.crew/config`)

Walking-skeleton design for the workspace-config work package. This sprint
ships the first end-to-end path that loads `.crew/config` into a typed,
validated `WorkspaceConfig` object via `@daddia/crew/config`.

Domain-wide patterns (typed config + `Secret` brand + `loadYaml`,
`detectWorkspace`, error taxonomy) are authoritative in
[`solution.md`](../../architecture/solution.md) §4.1 and are not repeated here.
The "steering docs are a prerequisite" guarantee operationalised by this WP is
authoritative in [`principles.md`](../../architecture/principles.md) §3.

## 1. The slice

> **An agent or skill running on a workspace repo calls
> `loadWorkspaceConfig(cwd)` from `@daddia/crew/config`. The function walks up
> to the nearest `.crew/config`, parses the YAML, validates it against the
> v0.1.0 Zod schema, resolves all `steering.*` paths relative to the workspace
> root, and returns a typed `WorkspaceConfig`. Repo-local skills working on
> the Crew repo (e.g. `write-wp-design`, `implement`) can read
> `cfg.source.issues.key`, `cfg.steering.strategy`, and `cfg.source.repo.ref`
> without hardcoding any of those values.**

What does **not** yet work after this sprint: deployable crews
(`delivery-build`, future `delivery-qa`/`delivery-review`) still get identity
from env via `loadEnv`; nothing in the runtime call path depends on
`WorkspaceConfig`. Wiring is opt-in for repo-local consumers only.

## 2. Files shipped

```text
packages/crew/src/config/
  workspace-schema.ts        NEW     Zod schema + WorkspaceConfig type; v0.1.0 only
  workspace-config.ts        NEW     loadWorkspaceConfig(cwd) helper; composes
                                     detectWorkspace + loadYaml + post-validation
  parse-ref.ts               NEW     parseRef("gh:daddia/crew") -> { scheme, provider, key };
                                     supports gh|gl|github|gitlab schemes
  index.ts                   EVOLVE  re-export loadWorkspaceConfig, parseRef,
                                     WorkspaceConfig, ParsedRef, RefScheme types
  detect-workspace.ts        KEEP    no change
  load-yaml.ts               KEEP    no change
  errors.ts                  KEEP    reuse ConfigNotFoundError, SchemaValidationError

packages/crew/tests/config/
  workspace-config.test.ts   NEW     happy path; missing file; invalid YAML;
                                     schema_version mismatch; missing steering file;
                                     base_url trailing-slash normalisation
  parse-ref.test.ts          NEW     gh/gl shorthand; github/gitlab long form;
                                     malformed ref; mismatch with provider field

packages/crew/.changeset/
  workspace-config.md        NEW     minor bump; new exports listed

packages/crew/
  CHANGELOG.md               EVOLVE  generated entry on release
  src/index.ts               KEEP    workspace config is subpath-only (config/*)
```

No changes to any `crews/*/` package this sprint -- consumers wire in a later
WP. Repo-local skills under `.agents/skills/*` may add a small helper to call
`loadWorkspaceConfig` from a script, but that is an additive consumer, not part
of this WP's contract.

## 3. Acceptance gates

### 3.1 End-to-end path

`loadWorkspaceConfig(process.cwd())` invoked from anywhere inside the Crew
monorepo returns a `WorkspaceConfig` whose:

- `schema_version === "0.1.0"`.
- `project.key === "CREW"`.
- `source.repo.ref.scheme === "gh"` and `source.repo.ref.provider === "github"`
  and `source.repo.ref.key === "daddia/crew"`.
- `source.issues.base_url === "https://carinyaparc.atlassian.net"` (trailing
  slash, if any, stripped by the loader).
- `steering.strategy`, `steering.solution`, `steering.roadmap`,
  `steering.principles` resolve to absolute paths under the detected workspace
  root; each path exists on disk and is non-empty.

A single integration test exercises this against the live `crew/.crew/config`
checked into this repo.

### 3.2 Observability hook fires

`loadWorkspaceConfig` emits one structured log line on success:

```text
config.workspace.loaded
  workspace_root  <absolute path>
  schema_version  0.1.0
  project_key     CREW
```

No secrets, no full config payload, no integration URLs beyond `project_key`.
Log namespace follows the dot-namespaced convention from
[`AGENTS.md`](../../../AGENTS.md) ("Logging").

### 3.3 Error path exercised

Four typed error surfaces, each reusing existing primitives from
`@daddia/crew/config` ([`solution.md`](../../architecture/solution.md) §4.1):

| Trigger                                              | Error                  | Message includes              |
|------------------------------------------------------|------------------------|-------------------------------|
| No `.crew/config` found between `cwd` and `/`        | `ConfigNotFoundError`  | search start dir              |
| File present but invalid YAML                        | `SchemaValidationError`| `path: ""`, `invalid YAML`    |
| `schema_version` outside supported range (`0.1.x`)   | `SchemaValidationError`| supported range, found value  |
| Required `steering.*` path missing or empty on disk  | `SchemaValidationError`| missing steering key + path   |
| `source.repo.ref` malformed or scheme/provider clash | `SchemaValidationError`| ref string + expected schemes |

All errors surface via the typed exception layer; nothing throws raw `Error`.

### 3.4 Quality gates

- `pnpm typecheck` passes for `packages/crew`.
- `pnpm test --filter @daddia/crew packages/crew/tests/config/` passes.
- `pnpm lint` passes (no boundary violations; `process.env` not read in any new
  file -- workspace config is a file loader, not an env loader).
- A changeset is added under `packages/crew/.changeset/` flagging a **minor**
  bump (new public exports, no breaking change to existing subpath).
- The new exports appear in `packages/crew/src/config/index.ts` and are
  reachable as `@daddia/crew/config` consumers (no second subpath introduced).

## 4. What this WP did NOT deliver

- **No wiring into deployable crews.** `delivery-build` continues to read
  identity (`JIRA_PROJECT_KEY`, `ATLASSIAN_BASE_URL`, etc.) from env via the
  existing `crews/delivery-build/src/config.ts`. Replacing those env-sourced
  identity fields with workspace-sourced equivalents is a separate WP.
- **No `requirements.yaml` / `bindings.yaml`.** Boot validation in this WP is
  inline in `loadWorkspaceConfig` (steering files exist + are non-empty);
  externalised contract files are deferred.
- **No URL derivation.** Browse URLs (`source.issues.url`,
  `source.docs.url`) stay explicit in YAML; the loader does not compose them
  from `base_url` + `key`.
- **No ref parsing for `jira:`, `confluence:`, `slack:` schemes.** Only
  `source.repo.ref` accepts a ref string; other sources keep
  `provider` + `key`.
- **No cross-field equality enforcement.** `project.key` and `source.*.key`
  may differ; the loader does not assert they match (per the explicit decision
  in §5).
- **No hot-reload.** `loadWorkspaceConfig` is read-once; callers cache the
  result for the process lifetime.
- **No workspace-config caching across processes.** Each invocation re-reads
  the file. Acceptable at repo-local skill scope; revisit if a hot path
  emerges.
- **No `.crew/local/overrides.yaml` merge layer.** Operator-local overrides
  are deferred.
- **No multi-workspace / monorepo sub-root support.** `workspace.path` is
  parsed but the loader treats `.` as authoritative; sub-root resolution is
  deferred.

## 5. Open questions closed during this sprint

- **Top-level key is `source` (singular), not `sources`.** Locked in the v0.1.0
  schema; consumers reference `cfg.source.*`.
- **Generic field names per source block.** `key` and `url` inside `issues`,
  `docs`, `chat` -- not `issues_key`, `docs_url`, etc.
- **Repo identity uses `ref` (`gh:daddia/crew`) plus `provider: github`.**
  Loader normalises shorthand to long form (`gh` -> `github`, `gl` -> `gitlab`)
  and validates that the ref scheme is consistent with the explicit
  `provider` field. Both fields stay -- `provider` for in-config readability,
  `ref` for compact identity downstream consumers can split.
- **Allowed ref schemes:** `gh`, `gl`, `github`, `gitlab`. Documented in the
  schema and in the loader's ref-scheme registry; other schemes throw
  `SchemaValidationError`.
- **`schema_version` is a semver string, supported range is `0.1.x` only.**
  `0.2.0` and `1.0.0` are rejected this sprint; a later WP widens the range.
- **No cross-key equality assertion.** `project.key === source.issues.key` is
  **not** enforced -- in real workspaces the human project name, the issue
  tracker project key, and the docs space key can legitimately differ.
- **Trailing slashes on `base_url` are normalised in the loader**, not in the
  YAML. Callers can rely on `${base_url}/path` concatenation.
- **`workspace.path: .` is retained** but not yet used; reserved for monorepo
  sub-root cases handled in a later WP.

## 6. Handoff to next WP

When this WP closes, the next WP can safely assume:

- `@daddia/crew/config` exports `loadWorkspaceConfig`, `parseRef`, the
  `WorkspaceConfig` type, the `ParsedRef` type, and the `RefScheme` union.
- `loadWorkspaceConfig(cwd)` is the single supported entry point for reading
  a workspace manifest; consumers do not call `loadYaml` directly against
  `.crew/config`.
- Steering paths returned by the loader are **absolute** and have been
  existence- and non-empty-checked at boot. Consumers do not re-check.
- The schema is frozen at `0.1.0`; any field addition is a minor bump and a
  schema-version range widening.

Two follow-on WPs unlock from here:

1. **Workspace-sourced identity for `delivery-build`.** Replace
   `JIRA_PROJECT_KEY`, `ATLASSIAN_BASE_URL`, `GITLAB_PROJECT_ID` env reads
   with values pulled from the target repo's `.crew/config` at boot; keep
   secrets and per-instance behaviour in env. Requires the existing
   `crews/delivery-build/src/config.ts` to compose env (secrets + behaviour)
   with workspace config (identity) and assert the merged result against the
   crew's existing Zod schema.
2. **Repo-local skill grounding.** Skills under `.agents/skills/*` adopt the
   loader so generated artefact paths (e.g. `docs/design/{feature}/{taskId}/`)
   and steering references resolve from `WorkspaceConfig.workspace.work` and
   `WorkspaceConfig.steering.*` instead of skill-local string literals.
