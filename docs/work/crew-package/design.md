---
type: Design
scope: work-package
mode: walking-skeleton
work_package: crew-package
epic: CREW-56
version: '0.1'
owner: daddia
status: Draft
last_updated: 2026-05-04
related:
  - docs/product/product.md
  - docs/work/crew-package/backlog.md
---

# Design -- Consolidate packages into `@daddia/crew` (CREW-56)

Walking-skeleton design for `docs/work/crew-package/`, implementing CREW-56.

There is no parent solution.md for this work package. All cross-cutting
policies (dependency boundaries, build pipeline, typecheck requirements) are
defined in `.dependency-cruiser.cjs`, `turbo.json`, and `AGENTS.md` and are
referenced below rather than restated.

## 1. The slice

> **`packages/crew` exists as the single shared library. Both agents — `agents/delivery` and `agents/code-reviewer` — declare `@daddia/crew: workspace:*` as their only shared dependency and import all types, session utilities, hooks, loaders, and webhook primitives from it. The three legacy packages (`@daddia/contracts`, `@daddia/sdk`, `@daddia/webhooks`) are deleted. `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass from the repo root with no changes to any agent workflow, persona, or prompt.**

## 2. Files shipped

### 2.1 New package scaffold

```text
packages/crew/
  package.json              NEW  @daddia/crew manifest; exports "." and "./webhooks"
  tsconfig.json             NEW  TypeScript build config (same pattern as existing packages)
  src/
    agent.ts                NEW  Agent, AgentUnit, AgentInput, AgentResult, AgentDefinition, PersonaName
                                 (content moved from packages/contracts/src/agent.ts)
    unit.ts                 NEW  AgentUnit interface
                                 (content moved from packages/contracts/src/unit.ts)
    session.ts              NEW  resolveSession(), SessionOptions, ActiveSession
                                 (content moved from packages/sdk/src/session.ts;
                                  @daddia/contracts import replaced with ./agent.js)
    loaders.ts              NEW  readPromptFile(), readSkillsDir(), readSubagentsDir()
                                 (content moved from packages/sdk/src/loaders.ts; no import changes)
    hooks.ts                NEW  buildAuditHook(), boundedIterGuard(), IterationCapReached
                                 (content moved from packages/sdk/src/hooks.ts; no import changes)
    index.ts                NEW  barrel: re-exports all of the above
    webhooks/
      verify.ts             NEW  verifySignature(), SignatureError, Provider
                                 (content moved from packages/webhooks/src/verify.ts)
      replay.ts             NEW  checkReplayWindow(), ReplayError, ReplayCheckOptions
                                 (content moved from packages/webhooks/src/replay.ts)
      idempotency.ts        NEW  createIdempotencyStore(), IdempotencyStore
                                 (content moved from packages/webhooks/src/idempotency.ts)
      index.ts              NEW  barrel: re-exports verify, replay, idempotency
```

### 2.2 Agent migrations (delivery)

```text
agents/delivery/package.json                         EVOLVE  @daddia/crew replaces the three legacy deps
agents/delivery/src/workflow.ts                      EVOLVE  @daddia/contracts → @daddia/crew
                                                             @daddia/sdk → @daddia/crew
agents/delivery/src/agents/engineer/agent.ts         EVOLVE  both legacy imports → @daddia/crew
agents/delivery/src/agents/senior-engineer/agent.ts  EVOLVE  both legacy imports → @daddia/crew
agents/delivery/src/agents/tech-lead/agent.ts        EVOLVE  both legacy imports → @daddia/crew
agents/delivery/src/idempotency.ts                   EVOLVE  @daddia/webhooks → @daddia/crew/webhooks
agents/delivery/src/handlers/jira.ts                 EVOLVE  @daddia/webhooks → @daddia/crew/webhooks
agents/delivery/src/handlers/gitlab.ts               EVOLVE  @daddia/webhooks → @daddia/crew/webhooks
```

### 2.3 Agent migrations (code-reviewer)

```text
agents/code-reviewer/package.json                             EVOLVE  @daddia/crew replaces the two legacy deps
agents/code-reviewer/src/orchestrator.ts                      EVOLVE  @daddia/contracts → @daddia/crew
agents/code-reviewer/src/agents/code-quality/agent.ts         EVOLVE  both legacy imports → @daddia/crew
```

### 2.4 Tooling and docs

```text
.dependency-cruiser.cjs   EVOLVE  remove no-contracts-importing-packages rule (subject deleted);
                                  update any path references from packages/contracts or packages/sdk
                                  to packages/crew
AGENTS.md                 EVOLVE  replace @org/* and @daddia/contracts / @daddia/sdk / @daddia/webhooks
                                  with @daddia/crew and @daddia/crew/webhooks throughout
turbo.json                KEEP    task names (build/typecheck/test/dev) require no changes
pnpm-workspace.yaml       KEEP    packages/* glob covers packages/crew automatically
```

### 2.5 Deleted

```text
packages/contracts/  DELETE  superseded by packages/crew/src/agent.ts + unit.ts
packages/sdk/        DELETE  superseded by packages/crew/src/session.ts + loaders.ts + hooks.ts
packages/webhooks/   DELETE  superseded by packages/crew/src/webhooks/
```

## 3. Acceptance gates

### 3.1 End-to-end path

`pnpm build` completes with exit code 0 from the repo root. `packages/crew`
produces `dist/index.js` and `dist/webhooks/index.js`. Both agents produce
their `dist/` outputs. No build errors or unresolved module references.

### 3.2 Boundary rule fires

After `.dependency-cruiser.cjs` is updated, introducing a synthetic agent-to-agent
import (any `import` from `agents/delivery` referencing `agents/code-reviewer`)
causes `pnpm lint` to fail with a `no-cross-agent-imports` violation. This
confirms the boundary enforcement is still live after the rule file is edited
and the `no-contracts-importing-packages` rule is removed.

### 3.3 Error path proven

With `packages/contracts`, `packages/sdk`, and `packages/webhooks` deleted,
running `pnpm typecheck` on a branch that still contains a legacy import
(e.g. `import type { Agent } from "@daddia/contracts"`) produces a TypeScript
module-not-found error. This confirms the old names are no longer resolvable
and the migration is complete before the branch merges.

### 3.4 Quality gates

From the repo root, in sequence:

```
pnpm install        # lockfile resolves without @daddia/contracts, @daddia/sdk, @daddia/webhooks
pnpm build          # exit 0; dist/ present for packages/crew, agents/delivery, agents/code-reviewer
pnpm typecheck      # exit 0; no new type errors in any package or agent
pnpm lint           # exit 0 (dependency-cruiser); no boundary violations
pnpm test           # exit 0; all previously-passing tests continue to pass
```

## 4. Data contracts

No new types are introduced. All types are moved unchanged from their source
packages. The only internal change is in `packages/crew/src/session.ts`: the
import of `AgentDefinition` and `AgentInput` changes from
`"@daddia/contracts"` to `"./agent.js"` (relative, same package).

## 5. What this WP did NOT deliver

- Any new exports on `@daddia/crew` — the surface is identical to the union of
  the three legacy packages.
- Publishing `@daddia/crew` to a registry — the package remains `private: true`.
- Observability, memory helpers, or any shared utility not already present in
  the legacy packages.
- Modifications to any agent workflow, persona, prompt, or test logic.

## 6. Open questions closed during this sprint

- **Single package or subpath exports?** Decided: one package (`@daddia/crew`)
  with two entry points (`"."` and `"./webhooks"`). Rationale: subpath exports
  preserve the `better-sqlite3` boundary — `agents/code-reviewer` imports only
  from `"."` and does not pull in the native addon.

- **Which dep-cruiser rule governs the new package?** The existing
  `no-packages-importing-agents` rule already covers `packages/crew →  agents/`
  (forbidden). The `no-contracts-importing-packages` rule is removed since its
  subject no longer exists. No new rule is needed; the existing rules are
  sufficient.

- **`pnpm-workspace.yaml` change needed?** No. The `packages/*` glob already
  covers `packages/crew`.

## 7. Handoff to next WP

- `@daddia/crew` (`"."` and `"./webhooks"`) is the stable import contract for
  all current and future agent units.
- `dep-cruiser` boundary rules are updated and verified against a synthetic
  violation.
- `AGENTS.md` is the canonical reference for the package API.
- CREW-54-001 (fix `@org/` package names in AGENTS.md) is superseded by this
  WP — the AGENTS.md rewrite in CREW-56-005 covers the same file. Mark
  CREW-54-001 as cancelled or absorbed.
- Any new agent added after this WP should add only `"@daddia/crew": "workspace:*"`
  to its `package.json` `dependencies`. Webhook primitives are available via
  `@daddia/crew/webhooks` if the agent has inbound webhook handlers.
