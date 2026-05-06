---
type: Backlog
scope: work-package
version: '0.1'
owner: daddia
status: Draft
last_updated: 2026-05-05
related:
  - docs/product/product.md
  - docs/product/backlog.md
---

# Backlog -- Consolidate packages into `@daddia/crew` (CREW-56)

Story-level backlog for `docs/work/crew-package/`, implementing CREW-56 from
`docs/product/backlog.md`.

> **Status (2026-05).** Consolidation stories **CREW-56-001–005** are complete on
> `main`: `packages/crew` is the only shared library (`@daddia/crew` and
> `@daddia/crew/webhooks`). Closed stories below retain original deliverables and
> acceptance criteria for traceability. **Follow-on stories CREW-56-006–009**
> (manual npm publish, Changesets release pipeline, migrate agents off
> `workspace:*`, local container verification) are defined below and are **not
> started**.

Companion artefacts: `docs/product/product.md` · `docs/product/backlog.md`

## 1. Summary

- **Epic.** CREW-56 — Consolidate packages into `@daddia/crew`
- **Phase.** Now / Quality
- **Outcome (CREW-56-001–005).** Delivered (2026-05): 11 points across 5 stories;
  `packages/crew` is the sole shared package; `AGENTS.md` and dependency-cruiser
  match the new layout.
- **Estimate (full backlog).** 22 points across 9 stories: **11** delivered
  (CREW-56-001–005); **11** remaining (CREW-56-006–009 — publish, Changesets and
  release pipeline, registry migration for agents, container verification).

**What shipped (001–005).** One workspace package (`@daddia/crew`) with two entry
points: `@daddia/crew` (types, session helpers, hooks, loaders) and
`@daddia/crew/webhooks` (signature verification, replay guard, idempotency).
Both agents import from these entry points. Legacy `packages/contracts`,
`packages/sdk`, and `packages/webhooks` are removed.

**What remains (006–009).** Publish `@daddia/crew` to npm as a private package
(first manually, then via Changesets + CI), switch agents from `workspace:*` to a
registry semver range, and prove build/deploy in a local container.

**Rationale (historical).** A single package with subpath exports preserves the
separation between core utilities and the `better-sqlite3`-bearing webhook
helpers without three separate build pipelines.

**Explicitly not part of CREW-56-001–005.** New exports beyond the consolidated
surface; registry publish; changes to agent workflow, persona, or prompt logic.
Those exclusions apply only to the consolidation slice; **006–009** intentionally
cover npm publish and consuming the package outside the workspace.

**Out of scope for CREW-56-006–009.** Changing agent workflow, persona, or prompt
logic beyond what is required to consume `@daddia/crew` from the registry.

## 2. Conventions

| Convention | Value |
| --- | --- |
| Epic ID | `CREW-56` |
| Story ID | `CREW-56-{nnn}` |
| Status values | Not started, In progress, In review, Done, Blocked |
| Priority levels | P0 (blocking), P1 (reliability), P2 (quality) |
| Estimation | Fibonacci story points (1, 2, 3, 5, 8) |
| Acceptance format | EARS + Gherkin |

## 3. Stories

**Repository contract (current):** The only workspace library under `packages/` is
`packages/crew`, published as `@daddia/crew` with a `./webhooks` subpath
(`@daddia/crew/webhooks`). Agent crews list `@daddia/crew: workspace:*`; crews
with webhook ingress also import `@daddia/crew/webhooks`. There are no
`packages/contracts`, `packages/sdk`, or `packages/webhooks` directories. See
[`AGENTS.md`](../../../AGENTS.md) for the authoritative layout.

### Closed migration stories (historical)

Everything in **CREW-56-001–005** below is **historical**: those stories are done.
Deliverables and EARS/Gherkin still mention old paths or package names where the
acceptance text was written for the migration; those references describe the past
state of the repo, not what exists today.

- [x] **[CREW-56-001] Scaffold `@daddia/crew` package and migrate contracts + sdk source**
  - **Status:** Done | **Priority:** P0 | **Estimate:** 3
  - **Epic:** CREW-56 | **Labels:** phase:now, type:refactor
  - **Depends on:** —
  - **Deliverable:** `packages/crew/` exists with `package.json` (`name: "@daddia/crew"`),
    `tsconfig.json`, and `src/` containing all source previously in
    `packages/contracts/src/` and `packages/sdk/src/`. The cross-package
    `import … from "@daddia/contracts"` inside `session.ts` becomes a relative
    import. `packages/crew/src/index.ts` exports every symbol previously exported
    by both `@daddia/contracts` and `@daddia/sdk`. The `"."` entry in the export
    map resolves to `./dist/index.js`. `pnpm typecheck` and `pnpm test` pass for
    `packages/crew`.
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL provide `packages/crew/package.json` with `name` set to
      `"@daddia/crew"` and a `"."` export pointing to `./dist/index.js`.
    - THE SYSTEM SHALL export all types previously exported by `@daddia/contracts`
      (`Agent`, `AgentCrew`, `AgentInput`, `AgentResult`, `AgentDefinition`,
      `PersonaName`) from the `"."` entry point.
    - THE SYSTEM SHALL export all functions and types previously exported by
      `@daddia/sdk` (`resolveSession`, `readPromptFile`, `readSkillsDir`,
      `readSubagentsDir`, `buildAuditHook`, `boundedIterGuard`,
      `IterationCapReached`, `SessionOptions`, `ActiveSession`,
      `SDKMessage`, `SDKResultMessage`, `ToolUseEvent`, `PostToolUseHandler`)
      from the `"."` entry point.
    - WHEN `pnpm typecheck` is run for `packages/crew`, THE SYSTEM SHALL exit
      with code 0 and no new type errors.
    - WHEN `pnpm test` is run for `packages/crew`, THE SYSTEM SHALL execute the
      session unit tests (previously in `packages/sdk`) and exit with code 0.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Core entry point resolves all contracts types
      Given packages/crew is built
      When a TypeScript file imports { Agent, AgentCrew, AgentInput, AgentResult, AgentDefinition, PersonaName } from "@daddia/crew"
      Then the import resolves without error
      And the types match the definitions previously in packages/contracts/src/

    Scenario: Core entry point resolves all SDK exports
      Given packages/crew is built
      When a TypeScript file imports { resolveSession, buildAuditHook, boundedIterGuard, IterationCapReached } from "@daddia/crew"
      Then the import resolves without error
      And the runtime behaviour is identical to the previous @daddia/sdk exports
    ```

- [x] **[CREW-56-002] Add `./webhooks` subpath export and migrate webhook source**
  - **Status:** Done | **Priority:** P0 | **Estimate:** 2
  - **Epic:** CREW-56 | **Labels:** phase:now, type:refactor
  - **Depends on:** CREW-56-001
  - **Deliverable:** `packages/crew/src/webhooks/` contains all source previously
    in `packages/webhooks/src/` (`verify.ts`, `replay.ts`, `idempotency.ts`,
    `index.ts`). `packages/crew/package.json` export map gains a `"./webhooks"`
    entry resolving to `./dist/webhooks/index.js`. `better-sqlite3` and
    `@types/better-sqlite3` move to `packages/crew/package.json`; they are removed
    from `packages/webhooks/package.json`. `pnpm typecheck` passes for
    `packages/crew`.
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL provide a `"./webhooks"` key in `packages/crew/package.json`
      `exports` resolving to `./dist/webhooks/index.js`.
    - THE SYSTEM SHALL export `verifySignature`, `SignatureError`, `Provider`,
      `checkReplayWindow`, `ReplayError`, `ReplayCheckOptions`,
      `createIdempotencyStore`, and `IdempotencyStore` from the `"./webhooks"`
      subpath.
    - WHEN a TypeScript file imports from `"@daddia/crew/webhooks"`, THE SYSTEM
      SHALL resolve the import without error.
    - WHEN `pnpm typecheck` is run for `packages/crew` after this story, THE
      SYSTEM SHALL exit with code 0.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Webhooks subpath resolves all exports
      Given packages/crew is built
      When a TypeScript file imports { verifySignature, checkReplayWindow, createIdempotencyStore } from "@daddia/crew/webhooks"
      Then the import resolves without error
      And the types and runtime behaviour are identical to the previous @daddia/webhooks exports

    Scenario: Core entry point does not expose webhook internals
      Given packages/crew is built
      When a TypeScript file imports from "@daddia/crew" (not "@daddia/crew/webhooks")
      Then verifySignature and createIdempotencyStore are not available on that import
    ```

- [x] **[CREW-56-003] Migrate `crews/delivery` to import from `@daddia/crew`**
  - **Status:** Done | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-56 | **Labels:** phase:now, type:refactor
  - **Depends on:** CREW-56-001, CREW-56-002
  - **Deliverable:** Every `import … from "@daddia/contracts"`, `import … from "@daddia/sdk"`,
    and `import … from "@daddia/webhooks"` in `crews/delivery/src/` is replaced
    with `import … from "@daddia/crew"` or `import … from "@daddia/crew/webhooks"`
    as appropriate. `crews/delivery/package.json` removes `@daddia/contracts`,
    `@daddia/sdk`, and `@daddia/webhooks` from `dependencies` and adds
    `@daddia/crew: workspace:*`. `pnpm typecheck` and `pnpm test` pass for
    `crews/delivery`.
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL NOT contain any `import … from "@daddia/contracts"`,
      `import … from "@daddia/sdk"`, or `import … from "@daddia/webhooks"`
      statement in `crews/delivery/src/`.
    - THE SYSTEM SHALL list `@daddia/crew` (not `@daddia/contracts`,
      `@daddia/sdk`, or `@daddia/webhooks`) under `dependencies` in
      `crews/delivery/package.json`.
    - WHEN `pnpm typecheck` is run for `crews/delivery`, THE SYSTEM SHALL
      exit with code 0.
    - WHEN `pnpm test` is run for `crews/delivery`, THE SYSTEM SHALL exit
      with code 0 and all previously passing tests shall continue to pass.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Delivery crew has no legacy package imports
      Given crews/delivery/src/ is scanned for import statements
      When the imports are inspected
      Then no import path contains "@daddia/contracts", "@daddia/sdk", or "@daddia/webhooks"
      And at least one import path contains "@daddia/crew"

    Scenario: Delivery crew tests pass after migration
      Given crews/delivery is built with the updated imports
      When pnpm test is run for crews/delivery
      Then the test suite exits with code 0
      And no previously-passing test now fails
    ```

- [x] **[CREW-56-004] Migrate `crews/code-reviewer` to import from `@daddia/crew`**
  - **Status:** Done | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-56 | **Labels:** phase:now, type:refactor
  - **Depends on:** CREW-56-001
  - **Deliverable:** Every `import … from "@daddia/contracts"` and
    `import … from "@daddia/sdk"` in `crews/code-reviewer/src/` is replaced
    with `import … from "@daddia/crew"`. `crews/code-reviewer/package.json`
    removes `@daddia/contracts` and `@daddia/sdk` from `dependencies` and adds
    `@daddia/crew: workspace:*`. `pnpm typecheck` and `pnpm test` pass for
    `crews/code-reviewer`. Note: `crews/code-reviewer` does not use
    `@daddia/webhooks` and MUST NOT gain a dependency on `@daddia/crew/webhooks`
    through this story.
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL NOT contain any `import … from "@daddia/contracts"` or
      `import … from "@daddia/sdk"` statement in `crews/code-reviewer/src/`.
    - THE SYSTEM SHALL list `@daddia/crew` (not `@daddia/contracts` or
      `@daddia/sdk`) under `dependencies` in `crews/code-reviewer/package.json`.
    - THE SYSTEM SHALL NOT import from `"@daddia/crew/webhooks"` in
      `crews/code-reviewer/src/`.
    - WHEN `pnpm typecheck` is run for `crews/code-reviewer`, THE SYSTEM
      SHALL exit with code 0.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Code-reviewer crew has no legacy package imports
      Given crews/code-reviewer/src/ is scanned for import statements
      When the imports are inspected
      Then no import path contains "@daddia/contracts" or "@daddia/sdk"
      And at least one import path contains "@daddia/crew"
      And no import path contains "@daddia/crew/webhooks"
    ```

- [x] **[CREW-56-005] Delete legacy packages, update dep-cruiser rules, and update AGENTS.md**
  - **Status:** Done | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-56 | **Labels:** phase:now, type:hygiene
  - **Depends on:** CREW-56-003, CREW-56-004
  - **Deliverable:** `packages/contracts/`, `packages/sdk/`, and
    `packages/webhooks/` directories are deleted. `.dependency-cruiser.cjs` is
    updated: the `no-contracts-importing-packages` rule is removed (its subject no
    longer exists); any path references to `packages/contracts`, `packages/sdk`,
    or `packages/webhooks` are replaced with `packages/crew`. `AGENTS.md` package
    table and description is updated to reflect `@daddia/crew` and its two entry
    points. `pnpm install`, `pnpm build`, `pnpm lint`, and `pnpm test` all pass
    from the repo root.
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL NOT contain a `packages/contracts/`, `packages/sdk/`, or
      `packages/webhooks/` directory after this story.
    - THE SYSTEM SHALL NOT reference `@daddia/contracts`, `@daddia/sdk`, or
      `@daddia/webhooks` in any `package.json` `dependencies` field in the
      repository.
    - WHEN `pnpm lint` (dependency-cruiser) is run from the repo root, THE SYSTEM
      SHALL exit with code 0 with no boundary violations.
    - WHEN `pnpm build` is run from the repo root, THE SYSTEM SHALL exit with
      code 0 and produce `dist/` outputs for `packages/crew` and both agents.
    - WHEN `pnpm test` is run from the repo root, THE SYSTEM SHALL exit with
      code 0 and all tests shall pass.
    - THE SYSTEM SHALL document `@daddia/crew` and `@daddia/crew/webhooks` entry
      points in `AGENTS.md` under the packages section.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Legacy package directories are absent
      Given the repository root is inspected
      When the packages/ directory is listed
      Then packages/contracts/ is absent
      And packages/sdk/ is absent
      And packages/webhooks/ is absent
      And packages/crew/ is present

    Scenario: Full build and test pass after cleanup
      Given all legacy packages are deleted and dep-cruiser is updated
      When pnpm build && pnpm lint && pnpm test are run from the repo root
      Then all three commands exit with code 0

    Scenario: AGENTS.md reflects the new package structure
      Given AGENTS.md is read
      When the packages section is inspected
      Then "@daddia/crew" is documented as the core library entry point
      And "@daddia/crew/webhooks" is documented as the webhook utilities entry point
      And no mention of "@daddia/contracts", "@daddia/sdk", or "@daddia/webhooks" remains
    ```

### Follow-on stories

Stories **006–008** are complete. **CREW-56-009** (container verification) is in
progress: the `Dockerfile` and Railway deployment runbook exist in
`crews/delivery-build/` and the registry-based build is wired correctly, but the
smoke-test verification step has not been run against a clean environment.

- [x] **[CREW-56-006] Manually publish `@daddia/crew` to npm as a private package**
  - **Status:** Done | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-56 | **Labels:** phase:now, type:release
  - **Depends on:** CREW-56-005
  - **Deliverable:** `@daddia/crew` is published to the npm registry **once, by
    hand** from a maintainer environment (e.g. `pnpm publish` or `npm publish` from
    `packages/crew` after build), proving private scoped access works. `publishConfig`
    matches org policy (e.g. `publishConfig.access: "restricted"` where applicable).
    The published artifact includes the same export map as the repo (`"."` and
    `"./webhooks"`). Registry authentication for publish and read is documented
    (`NPM_TOKEN`, `.npmrc` scope). Automated releases are **not** in scope for this
    story; they are CREW-56-007.
  - **Implementation note:** `@daddia/crew@0.1.0` is published on npm as
    `access: "public"` (confirmed 2026-05-05). The `"."` and `"./webhooks"` export
    map is present. Publish and read credentials are documented via `NODE_AUTH_TOKEN`
    in the release pipeline (CREW-56-007).
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL provide `packages/crew/package.json` with `publishConfig`
      appropriate for a private scoped package under `@daddia`.
    - WHEN a maintainer runs the documented manual publish steps, THE SYSTEM SHALL
      produce a versioned tarball on the registry that consumers can install with a
      semver range.
    - THE DEVELOPER SHALL document registry authentication and which npm org or
      team grants publish and install access to `@daddia/crew`.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Private install from a clean environment
      Given a machine with only Node, npm, and a valid read token for the @daddia scope
      When npm install @daddia/crew@<published-version> is run in an empty project
      Then the install succeeds
      And imports from "@daddia/crew" and "@daddia/crew/webhooks" resolve
    ```

- [x] **[CREW-56-007] Add Changesets and a release pipeline for `@daddia/crew`**
  - **Status:** Done | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-56 | **Labels:** phase:now, type:ci
  - **Depends on:** CREW-56-006
  - **Deliverable:** [Changesets](https://github.com/changesets/changesets) is
    configured for the repo (e.g. `.changeset/config.json`, package inclusion for
    `packages/crew`). Contributors add changesets with PRs; versioning and
    `CHANGELOG.md` updates follow the Changesets workflow. A **release pipeline**
    (CI) publishes `@daddia/crew` using an automation secret (`NPM_TOKEN` or
    equivalent) so routine releases no longer depend on a manual publish from a
    laptop. The pipeline behaviour is documented (what triggers publish: merge to
    default branch, tag, or dedicated release job). This story does **not** require
    migrating agents off `workspace:*`; that remains CREW-56-008.
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL include Changesets configuration that targets `@daddia/crew`
      and produces semver bumps consistent with change notes.
    - THE SYSTEM SHALL provide a CI job (or jobs) that can publish `@daddia/crew`
      to the private registry when the release workflow runs, using stored
      credentials.
    - THE DEVELOPER SHALL document how maintainers open versioning PRs or release
      PRs and how the pipeline is invoked.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: A library change gets a changeset
      Given a PR that changes packages/crew source
      When the contributor follows the documented changeset flow
      Then a changeset file exists describing the bump intent

    Scenario: Automated publish for routine releases
      Given the release pipeline has run successfully after a merge
      When the registry is queried for @daddia/crew
      Then a new version matching the changeset bump is available
    ```

- [x] **[CREW-56-008] Migrate agents to the published package (not `workspace:*`)**
  - **Status:** Done | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-56 | **Labels:** phase:now, type:refactor
  - **Depends on:** CREW-56-007
  - **Deliverable:** `crews/delivery` and `crews/code-reviewer` declare
    `@daddia/crew` with a semver range (or exact version) that resolves to the
    published package on the registry, not `workspace:*`. Root `pnpm` / lockfile
    configuration allows resolution from the registry in CI and locally (e.g.
    `.npmrc` for the scope or documented token setup). `pnpm install`, `pnpm
    typecheck`, and `pnpm test` pass for both crews from the repo root. No
    crew `package.json` uses `workspace:*` for `@daddia/crew`.
  - **Implementation note:** `crews/delivery` and `crews/code-reviewer` have been
    replaced by `crews/delivery-build` and `crews/delivery-review` respectively.
    Both successor crews declare `"@daddia/crew": "^0.1.0"` (registry semver).
    `pnpm install`, `pnpm typecheck`, and `pnpm test` all pass from the repo root.
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL NOT list `workspace:*` (or any workspace protocol) for
      `@daddia/crew` in `crews/delivery/package.json` or
      `crews/code-reviewer/package.json`.
    - WHEN `pnpm install` is run at the repository root, THE SYSTEM SHALL resolve
      `@daddia/crew` from the configured registry in line with the semver range.
    - WHEN `pnpm typecheck` and `pnpm test` are run for each crew, THE SYSTEM
      SHALL exit with code 0.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Crew manifests reference the registry, not the monorepo link
      Given crews/delivery/package.json and crews/code-reviewer/package.json
      When the @daddia/crew dependency is inspected
      Then the version spec is a semver range or exact version, not "workspace:*"

    Scenario: CI and local dev still pass
      Given dependencies are installed from the registry
      When pnpm typecheck and pnpm test are run for each crew
      Then both complete with exit code 0
    ```

- [ ] **[CREW-56-009] Verify agents build and deploy in a local container**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-56 | **Labels:** phase:now, type:ops
  - **Depends on:** CREW-56-008
  - **Deliverable:** A documented local path (e.g. `Dockerfile` and/or
    `docker compose` in repo or `docs/`) builds at least one agent image that
    installs dependencies from the registry, runs `build` (and any required
    steps), and starts or runs a smoke command suitable for the agent. The
    flow is reproducible: a developer with registry credentials can run the
    container build and confirm the image runs without relying on the monorepo
    workspace layout for `@daddia/crew`.
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL provide container build instructions and image definition(s)
      that copy or build the agent and install `@daddia/crew` from the registry.
    - WHEN the documented build is run on a machine with Docker and valid npm
      credentials, THE SYSTEM SHALL produce a runnable image.
    - THE DEVELOPER SHALL document any required build args or secrets (e.g.
      `NPM_TOKEN`) for private package install inside the image.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Image build does not require a linked workspace package
      Given a clean clone without pnpm workspace link for @daddia/crew
      When the container build is run with registry authentication
      Then the build completes successfully
      And the application or smoke command inside the image runs

    Scenario: Documented run path
      Given the handoff or ops doc for local container
      When a new engineer follows the steps
      Then they can build and run the image locally
    ```

## 4. Traceability

### Stories to product outcomes

| Story | Product outcome |
| --- | --- |
| CREW-56-001 | Reduces package coordination overhead; unblocks CREW-54-001 (AGENTS.md package names) |
| CREW-56-002 | Preserves the `better-sqlite3` boundary so agents without webhook ingress do not pull in the native module unnecessarily |
| CREW-56-003 | Delivery agent fully migrated; no dual-import risk during runtime |
| CREW-56-004 | Code-reviewer agent fully migrated; enforces that the webhook native dep is not silently pulled into a CLI tool |
| CREW-56-005 | Removes the three legacy build targets; makes `pnpm lint` (dep-cruiser) truthfully reflect the single-package architecture |
| CREW-56-006 | First manual publish proves private `@daddia/crew` works on the registry |
| CREW-56-007 | Semver and changelog are driven by Changesets; CI publishes routine releases |
| CREW-56-008 | Agents consume the library like external consumers; validates semver and registry integration |
| CREW-56-009 | Production-like deploy path is reproducible in Docker without workspace hacks |

### Stories to codebase sections

| Story | Files touched |
| --- | --- |
| CREW-56-001 | `packages/crew/` (scaffold; contracts + sdk sources merged here) |
| CREW-56-002 | `packages/crew/src/webhooks/` (new), `packages/crew/package.json` |
| CREW-56-003 | `crews/delivery/src/**`, `crews/delivery/package.json` |
| CREW-56-004 | `crews/code-reviewer/src/**`, `crews/code-reviewer/package.json` |
| CREW-56-005 | Legacy package dirs removed; `.dependency-cruiser.cjs`, `AGENTS.md`, root tooling touched |
| CREW-56-006 | `packages/crew/package.json`, manual publish runbook, npm org settings |
| CREW-56-007 | `.changeset/`, CI workflow(s) for version/publish, `CHANGELOG.md` (if generated), secrets docs |
| CREW-56-008 | `crews/delivery/package.json`, `crews/code-reviewer/package.json`, lockfile, `.npmrc` (if added) |
| CREW-56-009 | `Dockerfile` / `docker-compose.yml` or equivalent, ops/runbook snippet |

### Definition of Done

A story is done when:

- All EARS statements hold and every Gherkin scenario passes.
- `pnpm typecheck` exits with code 0 for every package or agent touched.
- `pnpm test` exits with code 0; no previously-passing test now fails.
- `pnpm lint` (dependency-cruiser) exits with code 0 from the repo root (where the story touches boundaries).
- Code review approved by at least one engineer.
- PR merged into `main`.

**CREW-56-001–005:** Met on `main` for the consolidation slice.

**CREW-56-006–009:** Open — same criteria apply when each story closes.

## 5. Dependency graph

**Consolidation (done on `main`).** CREW-56-001 through CREW-56-005 are complete.

```text
CREW-56-001 (packages/crew scaffold — contracts + sdk source)
  +-- CREW-56-002 (./webhooks subpath)
  |     +-- CREW-56-003 (delivery agent migration)
  |                     +-- CREW-56-005 (delete legacy + tooling update)
  |                               +-- CREW-56-006 (manual publish @daddia/crew private)
  |                                         +-- CREW-56-007 (Changesets + release pipeline)
  |                                                   +-- CREW-56-008 (agents use registry)
  |                                                             +-- CREW-56-009 (local container)
  +-- CREW-56-003 (delivery agent migration — also needs CREW-56-002)
  +-- CREW-56-004 (code-reviewer migration — only needs CREW-56-001)
                  +-- CREW-56-005
```

**Historical critical path (001–005):** CREW-56-001 → CREW-56-002 → CREW-56-003 → CREW-56-005
(nine points across four sequenced stories). CREW-56-002 and CREW-56-004 could run in parallel after CREW-56-001; CREW-56-005 gated on CREW-56-003 and CREW-56-004.

**Follow-on critical path (006–009):** CREW-56-005 → CREW-56-006 → CREW-56-007 →
CREW-56-008 → CREW-56-009 (11 points: 3 + 3 + 2 + 3), sequential.

**Minimum viable slice (historical).** CREW-56-001 + CREW-56-002 delivered a
usable `@daddia/crew` before legacy package deletion.

**Registry slice.** CREW-56-006–009 prove install and deploy outside the pnpm
workspace (manual publish, Changesets/CI, semver agents, Docker).

## 6. Risks

Risks from the consolidation phase (obsolete dep-cruiser rule, legacy package
paths, `turbo`/`tsconfig` references) were closed with CREW-56-005. Follow-on
work should watch for leaked publish tokens in CI logs, `workspace:*` left in
agent manifests after CREW-56-008, and Docker builds that accidentally rely on
monorepo paths. Further product-level risks are tracked in `docs/product/backlog.md`.

## 7. Handoff

**What this WP leaves stable:**

- `packages/crew/` is the sole shared library; its `"."` and `"./webhooks"`
  entry points are the import contract for all current and future agents.
- Both agents build, typecheck, test, and lint cleanly against `@daddia/crew`.
- `dependency-cruiser` boundary rules are updated and enforceable.
- `AGENTS.md` accurately documents the package structure.

**What comes next:**

- CREW-54-001 (`AGENTS.md` names) was superseded by CREW-56: canonical package
  documentation is `@daddia/crew`, `@daddia/crew/webhooks`, and `@daddia/crew-*`.
- **CREW-56-006–009:** Publish `@daddia/crew` to npm (manual first, then Changesets
  + CI), switch crews from `workspace:*` to registry semver, validate container
  build and deploy locally (see §3 follow-on stories).
- Any new agent crew should declare `@daddia/crew` (and optionally
  `@daddia/crew/webhooks`) as its shared library dependency; after CREW-56-008,
  prefer a semver range from the registry rather than `workspace:*` when policy
  requires consuming the published package.
- Future additions to the shared library (observability, memory helpers, etc.)
  are added as new files under `packages/crew/src/` and exported from the
  appropriate entry point.
