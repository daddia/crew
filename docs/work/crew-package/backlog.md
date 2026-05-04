---
type: Backlog
scope: work-package
version: '0.1'
owner: daddia
status: Complete
last_updated: 2026-05-05
related:
  - docs/product/product.md
  - docs/product/backlog.md
---

# Backlog -- Consolidate packages into `@daddia/crew` (CREW-56)

Story-level backlog for `docs/work/crew-package/`, implementing CREW-56 from
`docs/product/backlog.md`.

> **Status (2026-05).** CREW-56 is complete: `packages/crew` is the only shared
> library (`@daddia/crew` and `@daddia/crew/webhooks`). Stories CREW-56-001
> through CREW-56-005 are done. The sections below retain the original
> deliverables and acceptance criteria for traceability.

Companion artefacts: `docs/product/product.md` · `docs/product/backlog.md`

## 1. Summary

- **Epic.** CREW-56 — Consolidate packages into `@daddia/crew`
- **Phase.** Now / Quality
- **Outcome.** Delivered (2026-05): 11 points across 5 stories; `packages/crew`
  is the sole shared package; `AGENTS.md` and dependency-cruiser match the new
  layout.

**What shipped.** One workspace package (`@daddia/crew`) with two entry points:
`@daddia/crew` (types, session helpers, hooks, loaders) and
`@daddia/crew/webhooks` (signature verification, replay guard, idempotency).
Both agents import from these entry points. Legacy `packages/contracts`,
`packages/sdk`, and `packages/webhooks` are removed.

**Rationale (historical).** A single package with subpath exports preserves the
separation between core utilities and the `better-sqlite3`-bearing webhook
helpers without three separate build pipelines.

**Explicitly not part of this WP.** New exports beyond the consolidated surface;
registry publish; changes to agent workflow, persona, or prompt logic.

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
      (`Agent`, `AgentUnit`, `AgentInput`, `AgentResult`, `AgentDefinition`,
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
      When a TypeScript file imports { Agent, AgentUnit, AgentInput, AgentResult, AgentDefinition, PersonaName } from "@daddia/crew"
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

- [x] **[CREW-56-003] Migrate `agents/delivery` to import from `@daddia/crew`**
  - **Status:** Done | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-56 | **Labels:** phase:now, type:refactor
  - **Depends on:** CREW-56-001, CREW-56-002
  - **Deliverable:** Every `import … from "@daddia/contracts"`, `import … from "@daddia/sdk"`,
    and `import … from "@daddia/webhooks"` in `agents/delivery/src/` is replaced
    with `import … from "@daddia/crew"` or `import … from "@daddia/crew/webhooks"`
    as appropriate. `agents/delivery/package.json` removes `@daddia/contracts`,
    `@daddia/sdk`, and `@daddia/webhooks` from `dependencies` and adds
    `@daddia/crew: workspace:*`. `pnpm typecheck` and `pnpm test` pass for
    `agents/delivery`.
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL NOT contain any `import … from "@daddia/contracts"`,
      `import … from "@daddia/sdk"`, or `import … from "@daddia/webhooks"`
      statement in `agents/delivery/src/`.
    - THE SYSTEM SHALL list `@daddia/crew` (not `@daddia/contracts`,
      `@daddia/sdk`, or `@daddia/webhooks`) under `dependencies` in
      `agents/delivery/package.json`.
    - WHEN `pnpm typecheck` is run for `agents/delivery`, THE SYSTEM SHALL
      exit with code 0.
    - WHEN `pnpm test` is run for `agents/delivery`, THE SYSTEM SHALL exit
      with code 0 and all previously passing tests shall continue to pass.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Delivery agent has no legacy package imports
      Given agents/delivery/src/ is scanned for import statements
      When the imports are inspected
      Then no import path contains "@daddia/contracts", "@daddia/sdk", or "@daddia/webhooks"
      And at least one import path contains "@daddia/crew"

    Scenario: Delivery agent tests pass after migration
      Given agents/delivery is built with the updated imports
      When pnpm test is run for agents/delivery
      Then the test suite exits with code 0
      And no previously-passing test now fails
    ```

- [x] **[CREW-56-004] Migrate `agents/code-reviewer` to import from `@daddia/crew`**
  - **Status:** Done | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-56 | **Labels:** phase:now, type:refactor
  - **Depends on:** CREW-56-001
  - **Deliverable:** Every `import … from "@daddia/contracts"` and
    `import … from "@daddia/sdk"` in `agents/code-reviewer/src/` is replaced
    with `import … from "@daddia/crew"`. `agents/code-reviewer/package.json`
    removes `@daddia/contracts` and `@daddia/sdk` from `dependencies` and adds
    `@daddia/crew: workspace:*`. `pnpm typecheck` and `pnpm test` pass for
    `agents/code-reviewer`. Note: `agents/code-reviewer` does not use
    `@daddia/webhooks` and MUST NOT gain a dependency on `@daddia/crew/webhooks`
    through this story.
  - **Design:** design is captured in `docs/work/crew-package/backlog.md` §3 (this document)
  - **Acceptance (EARS):**
    - THE SYSTEM SHALL NOT contain any `import … from "@daddia/contracts"` or
      `import … from "@daddia/sdk"` statement in `agents/code-reviewer/src/`.
    - THE SYSTEM SHALL list `@daddia/crew` (not `@daddia/contracts` or
      `@daddia/sdk`) under `dependencies` in `agents/code-reviewer/package.json`.
    - THE SYSTEM SHALL NOT import from `"@daddia/crew/webhooks"` in
      `agents/code-reviewer/src/`.
    - WHEN `pnpm typecheck` is run for `agents/code-reviewer`, THE SYSTEM
      SHALL exit with code 0.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Code-reviewer agent has no legacy package imports
      Given agents/code-reviewer/src/ is scanned for import statements
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

## 4. Traceability

### Stories to product outcomes

| Story | Product outcome |
| --- | --- |
| CREW-56-001 | Reduces package coordination overhead; unblocks CREW-54-001 (AGENTS.md package names) |
| CREW-56-002 | Preserves the `better-sqlite3` boundary so agents without webhook ingress do not pull in the native module unnecessarily |
| CREW-56-003 | Delivery agent fully migrated; no dual-import risk during runtime |
| CREW-56-004 | Code-reviewer agent fully migrated; enforces that the webhook native dep is not silently pulled into a CLI tool |
| CREW-56-005 | Removes the three legacy build targets; makes `pnpm lint` (dep-cruiser) truthfully reflect the single-package architecture |

### Stories to codebase sections

| Story | Files touched |
| --- | --- |
| CREW-56-001 | `packages/crew/` (scaffold; contracts + sdk sources merged here) |
| CREW-56-002 | `packages/crew/src/webhooks/` (new), `packages/crew/package.json` |
| CREW-56-003 | `agents/delivery/src/**`, `agents/delivery/package.json` |
| CREW-56-004 | `agents/code-reviewer/src/**`, `agents/code-reviewer/package.json` |
| CREW-56-005 | Legacy package dirs removed; `.dependency-cruiser.cjs`, `AGENTS.md`, root tooling touched |

### Definition of Done

A story in this backlog is done when:

- [x] All EARS statements hold and every Gherkin scenario passes.
- [x] `pnpm typecheck` exits with code 0 for every package or agent touched.
- [x] `pnpm test` exits with code 0; no previously-passing test now fails.
- [x] `pnpm lint` (dependency-cruiser) exits with code 0 from the repo root.
- [x] Code review approved by at least one engineer.
- [x] PR merged into main.

## 5. Dependency graph

**Outcome.** CREW-56-001 through CREW-56-005 are complete on main.

```text
CREW-56-001 (packages/crew scaffold — contracts + sdk source)
  +-- CREW-56-002 (./webhooks subpath)
  |     +-- CREW-56-003 (delivery agent migration)
  |                     +-- CREW-56-005 (delete legacy + tooling update)
  +-- CREW-56-003 (delivery agent migration — also needs CREW-56-002)
  +-- CREW-56-004 (code-reviewer migration — only needs CREW-56-001)
                  +-- CREW-56-005
```

**Historical critical path:** CREW-56-001 → CREW-56-002 → CREW-56-003 → CREW-56-005
(nine points across four sequenced stories). CREW-56-002 and CREW-56-004 could run in parallel after CREW-56-001; CREW-56-005 gated on CREW-56-003 and CREW-56-004.

**Minimum viable slice (historical).** CREW-56-001 + CREW-56-002 delivered a
usable `@daddia/crew` before legacy package deletion.

## 6. Risks

Risks R1–R3 were closed with CREW-56-005: the obsolete dep-cruiser rule was
removed, agents use `@daddia/crew` only, and tooling references `packages/crew`.
Further runtime risks are tracked in `docs/product/backlog.md`.

## 7. Handoff

**What this WP leaves stable:**

- `packages/crew/` is the sole shared library; its `"."` and `"./webhooks"`
  entry points are the import contract for all current and future agents.
- Both agents build, typecheck, test, and lint cleanly against `@daddia/crew`.
- `dependency-cruiser` boundary rules are updated and enforceable.
- `AGENTS.md` accurately documents the package structure.

**What comes next:**

- CREW-54-001 (`AGENTS.md` names) was superseded by CREW-56: canonical package
  documentation is `@daddia/crew`, `@daddia/crew/webhooks`, and `@daddia/agent-*`.
- Any new agent unit added after this WP should declare only `@daddia/crew`
  (and optionally `@daddia/crew/webhooks`) as its shared library dependency.
- Future additions to the shared library (observability, memory helpers, etc.)
  are added as new files under `packages/crew/src/` and exported from the
  appropriate entry point.
