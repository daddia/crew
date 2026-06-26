---
type: Backlog
level: epic
scope: product
version: '0.3'
owner: daddia
status: Current
last_updated: 2026-06-26
related:
  - docs/product/strategy.md
  - docs/product/roadmap.md
  - docs/architecture/solution.md
---

# Backlog -- Crew

- **Product:** [`strategy.md`](strategy.md)
- **Solution:** [`../architecture/solution.md`](../architecture/solution.md)
- **Roadmap:** [`roadmap.md`](roadmap.md)

## 1. Summary

**Objective.** Deliver the Crew platform from proof-of-concept to a hardened,
commercially available runtime and catalogue — starting with software delivery as
the first vertical proof, then broadening to additional crews, and eventually
exposing the compounding surface (memory, evaluation, routing) that differentiates
the platform from raw model calls. This backlog decomposes the phases in
[`roadmap.md`](roadmap.md) into epics; phase sequencing and exit criteria are
owned by the roadmap, not duplicated here.

**Delivery approach.** Prove the hardest thing first (`delivery-build` is the most
demanding crew). Every later crew inherits a runtime that has already earned crash
recovery, audit, bounded loops, and escalation. Ship the deterministic floor
before any agentic flexibility, and borrow substrate rather than rebuild it
(see [`solution.md`](../architecture/solution.md) §5.6, §11). Once the first
vertical is unattended-production-safe, open the catalogue.

**Prerequisites (complete).**

- `@daddia/crew` v0.4.x published to npm — `main`, `webhooks`, `config`, `state`,
  `workflow` subpaths all ship.
- `delivery-build` core workflow implemented (engineer + senior-engineer; Jira
  poll + GitLab webhooks).
- Platform authoring & quality loop (RH02) complete — `crew init`,
  `guard:invariants`, bundled docs, CrewBench (`crew eval`), progressive skills,
  compaction, run-stream, security model (see [`../work/TASKS.md`](../work/TASKS.md)).
- Crew flow contracts authored for the full delivery vertical (build, QA, review).
- Container deployment topology validated for server-shaped crews.
- Contributing guides and `AGENTS.md` in place for new crew/persona authoring.

**Prerequisites (required before Next can ship).**

- CREW-03 must be fully production-safe — it gates everything in the Next phase.
- The remote audit sink (CREW-04, `@daddia/crew/audit`) must ship before the first
  CLI-shaped crew (CREW-07, `code-reviewer`) can land.

**Out of scope.** Canonical no-gos live in [`strategy.md`](strategy.md) §8.
Phase-gated deferrals live in [`roadmap.md`](roadmap.md) §6 (Deferred beyond this cycle).

## 2. Conventions

| Convention     | Value                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| Epic ID        | `CREW-{nn}` (e.g. `CREW-01`) — zero-padded two digits                                   |
| Epic work path | `docs/work/{nn}-{slug}/` — epic number prefix + kebab-case slug (max two words in slug) |
| Task ID        | `CREW-{nn}-{nn}` in `docs/work/{nn}-{slug}/tasks.md`                                    |
| Status         | Not started · In progress · In review · Done · Blocked                                  |
| Priority       | P0 (must) · P1 (should) · P2 (stretch) · P3 (defer)                                     |
| Estimation     | Fibonacci story points (1, 2, 3, 5, 8, 13)                                              |

## 3. Epic breakdown

### Now phase

| Epic ID | Title                             | Phase | Priority | Deps    | Points | Work path                        | Status      |
| ------- | --------------------------------- | ----- | -------- | ------- | ------ | -------------------------------- | ----------- |
| CREW-01 | Shared runtime (`@daddia/crew`)   | Now   | P0       | —       | 40     | `docs/work/01-shared-runtime/`   | Done        |
| CREW-02 | `delivery-build` crew             | Now   | P0       | CREW-01 | 21     | `docs/work/02-delivery-build/`   | Done        |
| CREW-03 | Production readiness — build crew | Now   | P0       | CREW-02 | 13     | `docs/work/03-build-production/` | In progress |

### Next phase

| Epic ID | Title                                              | Phase | Priority | Deps             | Points | Work path                       | Status      |
| ------- | -------------------------------------------------- | ----- | -------- | ---------------- | ------ | ------------------------------- | ----------- |
| CREW-04 | Remote audit sink (`@daddia/crew/audit`)           | Next  | P0       | CREW-03          | TBD    | `docs/work/04-audit-sink/`      | Not started |
| CREW-05 | `delivery-qa` crew                                 | Next  | P0       | CREW-03          | TBD    | `docs/work/05-delivery-qa/`     | Not started |
| CREW-06 | `delivery-review` crew                             | Next  | P0       | CREW-05          | TBD    | `docs/work/06-delivery-review/` | Not started |
| CREW-07 | `code-reviewer` CLI crew                           | Next  | P1       | CREW-04          | TBD    | `docs/work/07-code-reviewer/`   | Not started |
| CREW-08 | Observability — OTel tracing                       | Next  | P1       | CREW-03          | TBD    | `docs/work/08-observability/`   | In progress |
| CREW-09 | Commercial foundations — licence gating            | Next  | P1       | CREW-06          | TBD    | `docs/work/09-commercial/`      | Not started |
| CREW-14 | Authoring ergonomics — `crew init`, invariants     | Next  | P0       | CREW-03          | 13     | `docs/work/14-authoring/`       | Done (RH02) |
| CREW-15 | CrewBench — `crew eval` and delivery fixtures      | Next  | P0       | CREW-03, CREW-14 | 21     | `docs/work/15-crewbench/`       | Done (RH02) |
| CREW-16 | Harness hardening — skills, compaction, run-stream | Next  | P1       | CREW-14          | 13     | `docs/work/16-harness/`         | Done (RH02) |
| CREW-17 | Security model and pre-production checklist        | Next  | P1       | CREW-03          | 5      | `docs/work/17-security-model/`  | Done (RH02) |

### Later phase

| Epic ID | Title                                        | Phase | Priority | Deps    | Points | Work path                           | Status      |
| ------- | -------------------------------------------- | ----- | -------- | ------- | ------ | ----------------------------------- | ----------- |
| CREW-10 | Discovery crews (PM, Architect)              | Later | P1       | CREW-06 | TBD    | `docs/work/10-discovery-crews/`     | Not started |
| CREW-11 | Documentation / release-notes crew           | Later | P1       | CREW-06 | TBD    | `docs/work/11-docs-crew/`           | Not started |
| CREW-12 | Pro-tier compounding surface                 | Later | P1       | CREW-09 | TBD    | `docs/work/12-compounding-surface/` | Not started |
| CREW-18 | Ingress conventions — channels and schedules | Later | P2       | CREW-06 | TBD    | `docs/work/18-ingress/`             | Not started |
| CREW-19 | Optional execution isolation (sandbox)       | Later | P2       | CREW-12 | TBD    | `docs/work/19-sandbox/`             | Not started |

### Future phase

| Epic ID | Title                   | Phase  | Priority | Deps             | Points | Work path                       | Status      |
| ------- | ----------------------- | ------ | -------- | ---------------- | ------ | ------------------------------- | ----------- |
| CREW-13 | Cross-crew orchestrator | Future | P1       | CREW-12, CREW-20 | TBD    | `docs/work/13-orchestrator/`    | Not started |
| CREW-20 | Turn-level durability   | Future | P1       | CREW-16          | TBD    | `docs/work/20-turn-durability/` | Not started |

## 4. Epic detail (Now phase)

### CREW-01 -- Shared runtime (`@daddia/crew`)

**Scope.** Publish the TypeScript monorepo package that every crew depends on.
Ships the `Agent`, `AgentCrew`, `AgentInput`, `AgentResult`, and `AgentDefinition`
contracts; the `resolveSession`, `buildAuditHook`, and `boundedIterGuard` helpers;
plus subpath exports `state` (SQLite `StateStore`), `workflow` (`WorkflowEngine` +
`WorkflowPlan`), `webhooks` (signature verification, replay guard, idempotency),
`config` (typed env loader + `Secret` brand), and `evals` (CrewBench).

**Key deliverables.** Published `@daddia/crew` on npm; all subpaths resolve and
export correctly; Changesets release pipeline wired to CI; integration tests cover
happy paths and local fallback for every subpath.

**Dependencies.** None — this epic is the foundation.

**Status.** Done. **Work path:** `docs/work/01-shared-runtime/` (retrospective; no
further authoring unless the runtime contract changes).

### CREW-02 -- `delivery-build` crew

**Scope.** The first crew running real Jira stories end-to-end. Implements the
build sequence in [`../design/crew-flows/delivery-build.md`](../design/crew-flows/delivery-build.md):
context seed → clarification assessment → implement → peer review (bounded loop,
`REFACTOR_LOOP_CAP`) → open MR → CI monitor (bounded loop, `CI_RETRY_CAP`) →
transition to "In QA". Two personas — `engineer` (implement, assess-clarification,
address-feedback) and `senior-engineer` (peer-code-review) — each with a minimal
`allowedTools` list and `buildAuditHook` enforced at runtime. Triggered by Jira
poll (primary) and `POST /webhooks/jira` (secondary); human feedback via MR
comments handled by `POST /webhooks/gitlab`.

**Key deliverables.** Working `delivery-build` server deployable to a container
host; Hono server with `/healthz`; both personas with prompts, skills, and tool
scoping; idempotent Jira + GitLab integrations; SQLite state store using
`@daddia/crew/state`; crash-recovery startup scan; complete escalation paths (loop
cap, clarification timeout, agent failure) all reaching "Needs human review"
without crashing the server.

**Dependencies.** CREW-01 (published `@daddia/crew` with `state`, `workflow`,
`webhooks`, `config` subpaths).

**Status.** In progress — validated 2026-06-26: 10/11 tasks done; CREW-02-01
Docker CI build scenario not evidenced in GitHub Actions (Dockerfile + registry pin
in place). Production-readiness items (CREW-03) remain. **Work path:**
`docs/work/02-delivery-build/`.

### CREW-03 -- Production readiness — build crew

**Scope.** Everything required to run `delivery-build` unattended on real stories
with confidence and evidence: a `pnpm diagnose` script verifying all integration
touch points; structured cost-per-run logging emitted on every `workflow.complete`;
`/healthz` reporting poller-tick status and SQLite health; an end-to-end smoke
against a live Jira board and GitLab project; an operations runbook; and three or
more real stories completing the autonomous path to "In QA". This epic is the
direct gate for the Now exit criteria in [`roadmap.md`](roadmap.md).

**Key deliverables.** `pnpm diagnose` passing all checks; `workflow.complete` log
with `totalCostUsd`, `durationMs`, and per-step breakdown; `/healthz` with a
structured JSON body; runbook covering deploy, smoke, monitoring, recovery, and
cost controls; three stories with provenance in the audit trail; all three
escalation paths verified manually.

**Dependencies.** CREW-02 (fully functional `delivery-build` workflow).

**Status.** In progress. **Work path:** `docs/work/03-build-production/`.

## 5. Dependency graph

```text
CREW-01  ─────────────────────────────────────────────────────────────────
  └── CREW-02 (delivery-build crew)
        └── CREW-03 (production readiness)
              ├── CREW-04 (audit sink)
              │     └── CREW-07 (code-reviewer CLI)
              ├── CREW-05 (delivery-qa)
              │     └── CREW-06 (delivery-review)
              │           ├── CREW-09 (commercial)
              │           │     └── CREW-12 (Pro-tier compounding)
              │           │           ├── CREW-13 (cross-crew orchestrator)
              │           │           │     └── CREW-20 (turn-level durability)
              │           │           └── CREW-19 (execution isolation)
              │           ├── CREW-10 (discovery crews)
              │           ├── CREW-11 (docs crew)
              │           └── CREW-18 (channels / schedules)
              ├── CREW-08 (OTel tracing)
              ├── CREW-14 (authoring ergonomics)
              │     ├── CREW-15 (CrewBench)
              │     └── CREW-16 (harness hardening)
              │           └── CREW-20 (turn-level durability)
              └── CREW-17 (security model)
```

**Critical path:** CREW-01 → CREW-02 → CREW-03 → CREW-05 → CREW-06 → CREW-09 →
CREW-12 → CREW-13.

**Quality path (parallel, Next phase):** CREW-03 → CREW-14 → CREW-15 → (ongoing)
CrewBench gates on every runtime change.

**Parallelisation opportunities (Next phase):**

- CREW-04 (audit sink) and CREW-05 (delivery-qa) can begin in parallel once CREW-03 exits.
- CREW-08 (OTel) can begin alongside any Next-phase epic — no story-data dependencies.
- CREW-07 (code-reviewer CLI) unblocks as soon as CREW-04 ships, independent of CREW-05 / CREW-06.

**Minimum viable slice (Now):** CREW-03 complete → Now exit criteria met → Next phase opens.

## 6. Risks

| ID  | Risk                                                                                                           | Likelihood | Impact | Mitigation                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | e2e smoke against a real board surfaces integration bugs that delay CREW-03                                    | Medium     | High   | Keep the smoke board simple (one project, four transitions); run diagnose before each smoke attempt                                                      |
| R2  | CREW-04 (audit sink) design takes longer than expected, blocking the CLI crew                                  | Medium     | Medium | Unblock CREW-07 design in parallel; ship CREW-06 first so CREW-04 is not on the critical path to the delivery vertical                                   |
| R3  | `delivery-qa` crew needs a managed QA environment unavailable at Next start                                    | Medium     | High   | Scope CREW-05 to a mocked/sandbox environment first; real integration in a follow-on story                                                               |
| R4  | Commercial foundations (CREW-09) take longer than runtime work, compressing the market window                  | Low        | High   | Scope licence gating as a thin wrapper; defer pricing UI; ship the mechanism not the full product                                                        |
| R5  | The second crew (CREW-05) surfaces shared-runtime gaps requiring a `@daddia/crew` bump and re-pin across crews | Medium     | Medium | Accept as expected graduation work; CREW-02 is the reference; the bump cost is mechanical                                                                |
| R6  | "Slowly add v1 features" silently becomes "rebuild v1" — re-platforming instead of shipping                    | Medium     | High   | Features return only when a shipped workflow needs them; substrate is borrowed not rebuilt; agentic orchestration stays deferred (solution.md §10.1 R14) |
| R7  | Authoring ergonomics drift as the catalogue grows, reintroducing copy-paste                                    | Medium     | Medium | CREW-14 shipped before the third crew; `guard:invariants` prevents env and boundary regressions                                                          |

Technical and architecture risks are authoritative in
[`../architecture/solution.md`](../architecture/solution.md) §10.1 and are not
duplicated here.
