---
type: Backlog
scope: product
version: '0.1'
owner: daddia
status: Draft
last_updated: 2026-05-23
related:
  - docs/product/strategy.md
  - docs/product/roadmap.md
  - docs/architecture/solution.md
---

# Backlog — Crew

- **Product strategy:** [`strategy.md`](strategy.md)
- **Solution architecture:** [`../architecture/solution.md`](../architecture/solution.md)
- **Phases and gates:** [`roadmap.md`](roadmap.md)

## 1. Summary

**Objective.** Deliver the Crew platform from proof-of-concept to a hardened, commercially available runtime and catalogue — starting with software delivery as the first vertical proof, then broadening to additional crews, and eventually exposing the compounding surface (memory, evaluation, routing) that differentiates the platform from raw model calls. The bet is stated in [`strategy.md`](strategy.md) §3: a shared runtime hosts a growing catalogue of independently deployable crews; each crew reuses the substrate without reimplementing it.

**Delivery approach.** Prove the hardest thing first (`delivery-build` is the most demanding crew). Every later crew inherits a runtime that has already earned crash recovery, audit, bounded loops, and escalation. Once the first vertical is unattended-production-safe, open the catalogue.

**Prerequisites (complete).**

- `@daddia/crew` v0.4.0 published to npm — `main`, `webhooks`, `config`, `state`, `workflow` subpaths all ship.
- `delivery-build` core workflow implemented (engineer + senior-ngineer; Jira poll + GitLab webhooks).
- Crew flow contracts authored for the full delivery vertical (build, QA, review).
- Railway deployment topology validated for server-shaped crews.
- Contributing guides and AGENTS.md in place for new crew/persona authoring.

**Prerequisites (required before core work can ship).**

- CREW-2 must be fully production-safe (CREW-3 gates everything in Next).
- Remote audit sink (`@daddia/crew/audit`) must ship before the first CLI-shaped crew (`code-reviewer`) can land — it is the only open blocker identified in [`solution.md`](../architecture/solution.md) §10.3.

**Out of scope.** The canonical no-gos live in [`strategy.md`](strategy.md) §5. Phase-gated deferrals live in [`roadmap.md`](roadmap.md) §Later and §Future.

## 2. Conventions

| Convention | Value |
|------------|-------|
| Epic ID | `CREW-{nn}` (e.g. `CREW-1`) |
| Story ID | `CREW-{nn}-{nn}` (defined inside the work-package backlog) |
| Status | Not started · In progress · In review · Done · Blocked |
| Priority | P0 (must have) · P1 (should have) · P2 (stretch) · P3 (defer) |
| Estimation | Fibonacci story points (1, 2, 3, 5, 8, 13) |
| Acceptance format | EARS + Gherkin at work-package scope |

## 3. Epic breakdown

### Now phase

| Epic | Title | Phase | Priority | Deps | Points | Work package | Status |
|------|-------|-------|----------|------|--------|--------------|--------|
| CREW-1 | Shared runtime — `@daddia/crew` | Now | P0 | — | 40 | `work/01-shared-runtime/` | Done |
| CREW-2 | `delivery-build` crew | Now | P0 | CREW-1 | 21 | `work/02-delivery-build/` | In progress |
| CREW-3 | Production readiness — build crew | Now | P0 | CREW-2 | 13 | `work/03-build-production/` | In progress |

### Next phase

| Epic | Title | Phase | Priority | Deps | Points | Work package | Status |
|------|-------|-------|----------|------|--------|--------------|--------|
| CREW-4 | Remote audit sink (`@daddia/crew/audit`) | Next | P0 | CREW-3 | TBD | `work/04-audit-sink/` (planned) | Not started |
| CREW-5 | `delivery-qa` crew | Next | P0 | CREW-3 | TBD | `work/05-delivery-qa/` (planned) | Not started |
| CREW-6 | `delivery-review` crew | Next | P0 | CREW-5 | TBD | `work/06-delivery-review/` (planned) | Not started |
| CREW-7 | `code-reviewer` CLI crew | Next | P1 | CREW-4 | TBD | `work/07-code-reviewer/` (planned) | Not started |
| CREW-8 | Observability — OTel tracing across crews | Next | P1 | CREW-3 | TBD | `work/08-otel/` (planned) | Not started |
| CREW-9 | Commercial foundations — licence gating | Next | P1 | CREW-6 | TBD | `work/09-commercial/` (planned) | Not started |

### Later phase

| Epic | Title | Phase | Priority | Deps | Points | Work package | Status |
|------|-------|-------|----------|------|--------|--------------|--------|
| CREW-10 | Discovery crews (PM, Architect) | Later | P1 | CREW-6 | TBD | (planned) | Not started |
| CREW-11 | Documentation / release-notes crew | Later | P1 | CREW-6 | TBD | (planned) | Not started |
| CREW-12 | Pro-tier compounding surface | Later | P1 | CREW-9 | TBD | (planned) | Not started |

### Future phase

| Epic | Title | Phase | Priority | Deps | Points | Work package | Status |
|------|-------|-------|----------|------|--------|--------------|--------|
| CREW-13 | Cross-crew orchestrator | Future | P1 | CREW-12 | TBD | (planned) | Not started |

## 4. Epic detail — Now phase

### CREW-1 — Shared runtime (`@daddia/crew`)

**Scope.** Publish the TypeScript monorepo package that every crew depends on. Ships the `Agent`, `AgentCrew`, `AgentInput`, `AgentResult`, and `AgentDefinition` contracts; the `resolveSession`, `buildAuditHook`, and `boundedIterGuard` helpers; plus four subpath exports: `state` (SQLite `StateStore`), `workflow` (`WorkflowEngine` + `WorkflowPlan`), `webhooks` (signature verification, replay guard, idempotency store), and `config` (typed env loader + `Secret` brand).

**Key deliverables.** Published `@daddia/crew` on npm at v0.4.0; all five subpaths resolve and export correctly; Changesets release pipeline wired to GitHub Actions; integration tests cover happy paths and local fallback for every subpath.

**Dependencies.** None — this epic is the foundation.

**Status.** Done. **Work package:** `work/01-shared-runtime/` (retrospective; no further authoring required unless the runtime contract changes).

---

### CREW-2 — `delivery-build` crew

**Scope.** The first crew running real Jira stories end-to-nd. Implements the full build sequence defined in [`docs/design/crew-flows/delivery-build.md`](../design/crew-flows/delivery-build.md): context seed → clarification assessment → implement → peer review (bounded loop, `REFACTOR_LOOP_CAP`) → open MR → CI monitor (bounded loop, `CI_RETRY_CAP`) → transition to "In QA". Two personas — `engineer` (implement, assess-clarification, address-feedback) and `senior-ngineer` (peer-code-review) — each with a minimal `allowedTools` list and `buildAuditHook` enforced at runtime. Triggered by Jira poll (primary) and `POST /webhooks/jira` (secondary). Human feedback via MR comments handled by `POST /webhooks/gitlab`.

**Key deliverables.** Working `delivery-build` server deployable to Railway; Hono server with `/healthz`; `engineer` and `senior-ngineer` personas with prompts, skills, and tool scoping; idempotent Jira + GitLab integrations; SQLite state store using `@daddia/crew/state`; crash-recovery startup scan; complete escalation paths (loop cap, clarification timeout, agent failure) all leading to "Needs human review" without crashing the server.

**Dependencies.** CREW-1 (published `@daddia/crew` with `state`, `workflow`, `webhooks`, `config` subpaths).

**Status.** In progress — core workflow implemented; production-readiness items (CREW-3) remain. **Work package:** `work/02-delivery-build/`.

---

### CREW-3 — Production readiness — build crew

**Scope.** Everything required to run `delivery-build` unattended on real stories with confidence and evidence. Specifically: a `pnpm diagnose` script that verifies all six integration touch points; structured cost-per-run logging emitted on every `workflow.complete` event; `/healthz` endpoint reporting poller tick status and SQLite health; end-to-nd smoke against a live Jira board and GitLab project; operations runbook; and three or more real stories completing the autonomous path to "In QA". This epic is the direct gate for the Now exit criteria in [`roadmap.md`](roadmap.md).

**Key deliverables.** `pnpm diagnose` passing all checks; `workflow.complete` log with `totalCostUsd`, `durationMs`, and per-step breakdown; `/healthz` with structured JSON body; runbook covering deploy, smoke, monitoring, recovery, and cost controls; three stories with provenance in the audit trail; all three escalation paths (loop cap, clarification timeout, agent failure) verified manually.

**Dependencies.** CREW-2 (fully functional `delivery-build` workflow).

**Status.** In progress. **Work package:** `work/03-build-production/`.

---

## 5. Dependency graph

```text
CREW-1  ─────────────────────────────────────────────────────────────────
  └── CREW-2 (delivery-build crew)
        └── CREW-3 (production readiness)
              ├── CREW-4 (audit sink)
              │     └── CREW-7 (code-reviewer CLI)
              ├── CREW-5 (delivery-qa)
              │     └── CREW-6 (delivery-review)
              │           ├── CREW-9 (commercial)
              │           │     └── CREW-12 (Pro-tier compounding)
              │           │           └── CREW-13 (cross-crew orchestrator)
              │           ├── CREW-10 (discovery crews)
              │           └── CREW-11 (docs crew)
              └── CREW-8 (OTel tracing)
```

**Critical path:** CREW-1 → CREW-2 → CREW-3 → CREW-5 → CREW-6 → CREW-9 → CREW-12 → CREW-13.

**Parallelisation opportunities (Next phase):**

- CREW-4 (audit sink) and CREW-5 (delivery-qa) can begin in parallel once CREW-3 exits.
- CREW-8 (OTel) can begin alongside any Next-phase epic — no story data dependencies.
- CREW-7 (code-reviewer CLI) unblocks as soon as CREW-4 ships, independent of CREW-5 / CREW-6.

**Minimum viable slice (Now):** CREW-3 complete → Now exit criteria met → Next phase opens.

## 6. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | e2e smoke against a real board surfaces integration-level bugs that delay CREW-3 | Medium | High | Keep the smoke Jira board simple (one project, four transitions); run diagnose before each smoke attempt |
| R2 | CREW-4 (audit sink API) design takes longer than expected, blocking the CLI crew | Medium | Medium | Unblock CREW-7 design in parallel; ship CREW-6 first so CREW-4 is not on the critical path to the delivery vertical |
| R3 | `delivery-qa` crew requires a managed QA environment that is not available at start of Next | Medium | High | Scope CREW-5 to a mocked/sandbox environment first; real-nv integration in a follow-on story |
| R4 | Commercial foundations (CREW-9) take longer than runtime work, compressing the market window | Low | High | Scope licence gating as a thin wrapper; defer pricing UI; ship the mechanism not the full product |
| R5 | The second crew (CREW-5) surfaces shared-runtime gaps that require a `@daddia/crew` version bump and re-pin across all crews | Medium | Medium | Accept this as expected graduation work; CREW-2 is already the reference; the bump cost is mechanical |

Technical and architecture risks are authoritative in [`../architecture/solution.md`](../architecture/solution.md) §10.1 and are not duplicated here.
