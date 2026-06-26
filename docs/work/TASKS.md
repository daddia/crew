---
type: Tasks
epic: platform-authoring
epic_id: RH02
version: '0.3'
owner: daddia
status: Current
last_updated: 2026-06-26
related:
  - docs/product/backlog.md
  - docs/architecture/solution.md
  - AGENTS.md
---

# Tasks -- Platform Authoring & Quality Loop (RH02)

RH01 (Runtime Hardening & Agent SDK Alignment) is **complete** — 16 tasks shipped.
This file tracks active work only.

Derived from the June 2026 strategic review. Maps to CREW-14–17 in
[`docs/product/backlog.md`](../product/backlog.md).

Companion artefacts: [`solution.md`](../architecture/solution.md) ·
[`roadmap.md`](../product/roadmap.md) · `AGENTS.md`.

## 1. Summary

- **Epic.** RH02 -- Platform Authoring & Quality Loop
- **Phase.** Next
- **Priority.** P0 for evals and authoring; P1 for harness and security docs
- **Estimate.** ~57 points across 12 tasks

**Scope.** Close the platform gaps identified in the June 2026 strategic review:
filesystem-first scaffolding, mechanical convention enforcement, fixture-owned
evals, progressive context control, operator visibility, and a published security
model — without changing Crew's core thesis (multi-persona crews, governed
harness, compounding above the model).

**Deliverables.** `crew init`; `guard:invariants`; bundled runtime docs;
`crew eval` with delivery-build smoke fixtures; progressive skill loading;
context compaction; run-stream for operators; security model doc.

**Dependencies.** RH01 complete; CREW-3 production-readiness gate in flight.

**Out of scope.** Cross-crew orchestrator (CREW-13), sandbox isolation
(CREW-19), channel/schedules generalisation (CREW-18), Pro control plane.

## 2. Conventions

| Convention | Value |
| ---------- | ----- |
| Task ID | `RH02-{nn}` |
| Acceptance | Gherkin required; EARS where a rule is clearer than a scenario |
| Provenance | Each task cites `solution.md` section or strategic review theme |

## 3. Tasks

### Authoring ergonomics (CREW-14)

- [x] **[RH02-01] Ship `crew init` scaffold CLI**
  - **Status:** Done | **Priority:** P0 | **Estimate:** 8
  - **Epic:** RH02 | **Labels:** phase:next, area:runtime, type:feature
  - **Depends on:** -
  - **Deliverable:** `npx @daddia/crew init <name> --shape server|cli` creates a crew from template, pins `@daddia/crew`, includes smoke eval stub and canonical `plugin/` layout. Replaces manual `cp -r`.
  - **Design:** `solution.md §4.3` · `contributing/adding-an-agent-crew.md`
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: A new server-shaped crew scaffolds from init
      Given an empty directory
      When crew init my-crew --shape server runs
      Then crews/my-crew exists with workflow.ts, config.ts, and one persona stub
      And package.json pins a registry @daddia/crew version
      And pnpm typecheck passes in the new crew

    Scenario: Init includes an eval stub
      Given a scaffolded crew
      When evals/smoke.eval.ts is present
      Then it imports from @daddia/crew/evals (or documents the pending subpath)
    ```

- [x] **[RH02-02] Add `guard:invariants` to CI**
  - **Status:** Done | **Priority:** P0 | **Estimate:** 5
  - **Epic:** RH02 | **Labels:** phase:next, area:runtime, type:feature
  - **Depends on:** -
  - **Deliverable:** Mechanical checks for AGENTS.md rules: `upsertStory` before `agent.run`, no `process.env` outside `config.ts`, no crew→crew imports, no duplicate `.claude/` + `plugin/` skill trees. Runs in `pnpm lint`.
  - **Design:** `solution.md §4.3` · `AGENTS.md` (pre-merge checklist)
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: A violation fails the guard
      Given a persona module that reads process.env directly
      When guard:invariants runs
      Then it exits non-zero with a file path and rule id

    Scenario: A compliant crew passes
      Given delivery-build at HEAD
      When guard:invariants runs
      Then it exits zero
    ```

- [ ] **[RH02-03] Bundle runtime docs in the published package**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** RH02 | **Labels:** phase:next, area:runtime, type:docs
  - **Depends on:** -
  - **Deliverable:** Selected docs (AGENTS.md excerpts, contributing guides, solution summary) ship under `node_modules/@daddia/crew/docs` in the npm tarball.
  - **Design:** `solution.md §4.3` · `strategy.md §3.2` (legible to agents)
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Published package includes docs
      Given @daddia/crew is packed for publish
      When the tarball is inspected
      Then docs/ contains at least AGENTS.md and adding-a-persona.md
    ```

- [x] **[RH02-04] Canonical persona layout — remove legacy skill trees**
  - **Status:** Done | **Priority:** P1 | **Estimate:** 5
  - **Epic:** RH02 | **Labels:** phase:next, area:delivery-build, type:refactor
  - **Depends on:** -
  - **Deliverable:** `delivery-build` personas use `plugin/` only; duplicate `.claude/skills/` trees removed; AGENTS.md and contributing guides updated.
  - **Design:** `solution.md §4.3`
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: No duplicate skill paths under a persona
      Given any persona under delivery-build
      When the agents tree is listed
      Then skills exist only under plugin/skills/
    ```

### CrewBench (CREW-15)

- [ ] **[RH02-05] Ship `@daddia/crew/evals` and `crew eval` CLI**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 13
  - **Epic:** RH02 | **Labels:** phase:next, area:runtime, type:feature
  - **Depends on:** RH02-01
  - **Deliverable:** `defineEval`, eval config, gate/soft assertions, `crew eval` command targeting local dev server or deployment URL; JUnit reporter for CI.
  - **Design:** `solution.md §7` (CrewBench) · `roadmap.md` (Next exit #5)
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: A smoke eval drives a real session
      Given delivery-build running locally with fixtures
      When crew eval runs evals/smoke.eval.ts
      Then the eval asserts session success and exits zero

    Scenario: A failed gate fails CI
      Given an eval with t.succeeded() as a gate
      When the agent returns success: false
      Then crew eval exits non-zero
    ```

- [ ] **[RH02-06] Delivery-build fixture eval suite**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 8
  - **Epic:** RH02 | **Labels:** phase:next, area:delivery-build, type:test
  - **Depends on:** RH02-05
  - **Deliverable:** Evals cover escalation (loop cap), tool allowlist denial, and handoff artefact shape; run in CI on PR.
  - **Design:** `docs/design/crew-flows/delivery-build.md`
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Loop cap escalation is eval-covered
      Given a fixture story that never passes peer review
      When the workflow eval runs to cap
      Then the eval asserts transition to Needs human review
    ```

### Harness hardening (CREW-16)

- [ ] **[RH02-07] Progressive skill loading**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 5
  - **Epic:** RH02 | **Labels:** phase:next, area:runtime, type:feature
  - **Depends on:** -
  - **Deliverable:** Skill descriptions advertised to the model; full SKILL.md bodies loaded only when the task matches (SDK skill loading or runtime `load_skill` equivalent).
  - **Design:** `solution.md §7` (Context control)
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Unused skills do not inflate the initial prompt
      Given a persona with five skills
      When a clarify-only task runs
      Then only the relevant skill body is loaded for that task
    ```

- [ ] **[RH02-08] Context compaction hook in resolveSession**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 5
  - **Epic:** RH02 | **Labels:** phase:next, area:runtime, type:feature
  - **Depends on:** -
  - **Deliverable:** Configurable compaction threshold before context window overflow on long implementation runs; preserves tool-state invariants where the SDK supports it.
  - **Design:** `solution.md §4.4` (Session durability)
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: A long session compacts instead of failing
      Given maxTurns allows continuation past compaction threshold
      When context size exceeds the configured threshold
      Then older turns are summarized and the session continues
    ```

- [ ] **[RH02-09] Operator run-stream API**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 8
  - **Epic:** RH02 | **Labels:** phase:next, area:delivery-build, type:feature
  - **Depends on:** -
  - **Deliverable:** `GET /runs/:issueKey/stream` (or equivalent) emits structured progress events for an in-flight story; subagent session IDs correlated in audit.
  - **Design:** `solution.md §7` (Operator visibility)
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: An operator inspects overnight progress
      Given a story in implement step
      When the run stream is subscribed
      Then tool-use and subagent events arrive in order with issueKey
    ```

- [ ] **[RH02-10] Local fixture story driver**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 5
  - **Epic:** RH02 | **Labels:** phase:next, area:delivery-build, type:feature
  - **Depends on:** RH02-05
  - **Deliverable:** `pnpm dev:story CREW-123` (or `crew run --fixture`) drives one workflow path with mocked Jira/GitLab; no live board required for persona iteration.
  - **Design:** `roadmap.md` (dev ergonomics)
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: A fixture story runs offline
      Given fixtures/CREW-123/ with mocked integration responses
      When the story driver runs implement
      Then the engineer session completes without live Jira credentials
    ```

### Security & research (CREW-17, CREW-20)

- [ ] **[RH02-11] Publish security model and pre-production checklist**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 5
  - **Epic:** RH02 | **Labels:** phase:next, area:security, type:docs
  - **Depends on:** -
  - **Deliverable:** `docs/architecture/security-model.md` (runtime vs workspace vs MCP); checklist in delivery runbook; aligns with existing webhook verification and untrusted-input delimiters.
  - **Design:** `solution.md §7` (Security model)
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Pre-production checklist is complete for delivery-build
      Given the delivery-build runbook
      When the checklist is followed for a new deployment
      Then every item maps to an existing control or a tracked gap
    ```

- [ ] **[RH02-12] Research turn-level durability for long agent runs**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 8
  - **Epic:** RH02 | **Labels:** phase:future, area:runtime, type:spike
  - **Depends on:** RH02-08
  - **Deliverable:** ADR or research note comparing step-checkpoint options for in-run tool replay; recommendation for CREW-20. No implementation required in RH02.
  - **Design:** `solution.md §4.4` · `solution.md §10.3` (open question #7)
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Research artefact exists
      Given the spike completes
      When docs/architecture/decisions/ or research/ is updated
      Then options, trade-offs, and a recommended path are documented
    ```

## 4. Traceability and DoD

### Tasks to solution sections

| Task | solution.md |
| ---- | ----------- |
| RH02-01 | §4.3 Filesystem authoring |
| RH02-02 | §4.3 Convention enforcement |
| RH02-03 | §4.3 Bundled docs |
| RH02-04 | §4.3 Canonical layout |
| RH02-05 | §7 CrewBench |
| RH02-06 | delivery-build flow |
| RH02-07 | §7 Context control |
| RH02-08 | §4.4 Session durability |
| RH02-09 | §7 Operator visibility |
| RH02-10 | roadmap Next |
| RH02-11 | §7 Security model |
| RH02-12 | §4.4 Turn durability; §10.3 Q7 |

### Definition of Done

- [ ] All Gherkin scenarios pass for completed RH02 tasks
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `guard:invariants` are green
- [ ] `@daddia/crew` bumped, published, and re-pinned where contract changes
- [ ] At least one `crew eval` runs in CI on every PR touching crews or runtime

## 5. Handoff

Completing RH02-05 and RH02-06 satisfies roadmap Next exit criteria #5–6 and
feeds CrewBench baseline population (roadmap exit #3). RH02-12 informs CREW-20
and Future orchestrator design without blocking the delivery vertical.

Authoring ergonomics and CrewBench are P0 — they defend the catalogue as prompt
and harness changes accelerate. Harness hardening and the security model can run
in parallel once CREW-3 exits.
