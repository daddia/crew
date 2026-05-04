---
type: Design
scope: work-package
mode: as-built
work_package: crew-package
epic: CREW-56
version: '0.1'
owner: daddia
status: Complete
last_updated: 2026-05-05
related:
  - docs/product/product.md
  - docs/work/crew-package/backlog.md
---

# Design -- Consolidate packages into `@daddia/crew` (CREW-56)

As-built design for `docs/work/crew-package/`, recording CREW-56 after merge.

There is no parent solution.md for this work package. All cross-cutting
policies (dependency boundaries, build pipeline, typecheck requirements) are
defined in `.dependency-cruiser.cjs`, `turbo.json`, and `AGENTS.md` and are
referenced below rather than restated.

## 1. The slice

> **`packages/crew` exists as the single shared library. Both agents — `agents/delivery` and `agents/code-reviewer` — declare `@daddia/crew: workspace:*` as their only shared dependency and import all types, session utilities, hooks, loaders, and webhook primitives from it. The three legacy packages (`@daddia/contracts`, `@daddia/sdk`, `@daddia/webhooks`) are deleted. `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass from the repo root with no changes to any agent workflow, persona, or prompt.**

## 2. Repository layout

### 2.1 Shared library (`packages/crew`)

```text
packages/crew/
  package.json          # name @daddia/crew; exports "." and "./webhooks"
  tsconfig.json
  src/
    agent.ts            # Agent, AgentUnit, AgentInput, AgentResult, AgentDefinition, PersonaName
    unit.ts
    session.ts          # resolveSession(); imports agent types via ./agent.js
    loaders.ts          # readPromptFile(), readSkillsDir(), readSubagentsDir()
    hooks.ts            # buildAuditHook(), boundedIterGuard(), IterationCapReached
    index.ts            # main entry barrel
    webhooks/
      verify.ts
      replay.ts
      idempotency.ts
      index.ts          # @daddia/crew/webhooks entry
```

### 2.2 Agents

`agents/delivery` and `agents/code-reviewer` depend on `@daddia/crew`. Delivery
imports `@daddia/crew/webhooks` where inbound webhooks need verification or
idempotency.

### 2.3 Tooling

`.dependency-cruiser.cjs` enforces boundaries; the legacy
`no-contracts-importing-packages` rule was removed when `packages/contracts`
ceased to exist. `AGENTS.md` documents `@daddia/crew` and `@daddia/crew/webhooks`.
`turbo.json` and `pnpm-workspace.yaml` use the usual `packages/*` workspace
layout.

### 2.4 Historical note

Former directories `packages/contracts`, `packages/sdk`, and `packages/webhooks`
were removed after CREW-56; their sources now live under `packages/crew/src/` as
above.

## 3. Acceptance gates

### 3.1 End-to-end path

`pnpm build` completes with exit code 0 from the repo root. `packages/crew`
produces `dist/index.js` and `dist/webhooks/index.js`. Both agents produce
their `dist/` outputs. No build errors or unresolved module references.

### 3.2 Boundary rule fires

Introducing a synthetic agent-to-agent import (for example an `import` from
`agents/delivery` referencing `agents/code-reviewer`) causes `pnpm lint` to fail
with a `no-cross-agent-imports` violation. This confirms boundary enforcement
remains active after the dep-cruiser edits for CREW-56.

### 3.3 Error path proven

On a branch that still used legacy imports (for example
`import type { Agent } from "@daddia/contracts"`), `pnpm typecheck` would fail
with module-not-found. The consolidated package exposes those types from
`@daddia/crew` only.

### 3.4 Quality gates

From the repo root, in sequence:

```
pnpm install        # workspace resolves; shared library is packages/crew only
pnpm build          # exit 0; dist/ present for packages/crew, agents/delivery, agents/code-reviewer
pnpm typecheck      # exit 0; no new type errors in any package or agent
pnpm lint           # exit 0 (dependency-cruiser); no boundary violations
pnpm test           # exit 0; all previously-passing tests continue to pass
```

## 4. Data contracts

No new public types were added in CREW-56: the shared surface matches the
previously split packages. In `packages/crew/src/session.ts`, `AgentDefinition`
and `AgentInput` are imported from `"./agent.js"` (same package), not from a
separate contracts package.

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
  `no-packages-importing-agents` rule already covers `packages/crew → agents/`
  (forbidden). The old `no-contracts-importing-packages` rule was removed with
  the `packages/contracts` directory. No extra rule was required.

- **`pnpm-workspace.yaml` change needed?** No. The `packages/*` glob already
  covers `packages/crew`.

## 7. Handoff to next WP

- `@daddia/crew` (`"."` and `"./webhooks"`) is the stable import contract for
  all current and future agent units.
- `dep-cruiser` boundary rules are updated and verified against a synthetic
  violation.
- `AGENTS.md` is the canonical reference for the package API.
- CREW-54-001 (`AGENTS.md` package naming) is superseded by CREW-56: `AGENTS.md`
  now documents `@daddia/crew` and related names consistently.
- Any new agent added after this WP should add only `"@daddia/crew": "workspace:*"`
  to its `package.json` `dependencies`. Webhook primitives are available via
  `@daddia/crew/webhooks` if the agent has inbound webhook handlers.
