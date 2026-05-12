---
type: Backlog
scope: product
product: crew-runtime
version: '4.0'
owner: daddia
status: Active
last_updated: 2026-05-12
related:
  - docs/crew-flows/delivery-build.md
  - docs/product/product.md
  - AGENTS.md
---

# Backlog -- Delivery-Build Slice (v4)

Objective: ship `delivery-build` as a working end-to-end slice. The crew picks
up a Jira story via polling, clarifies ambiguities with the PM, implements it
on a branch, drives it through peer review and CI, and hands off to `In QA`
for the delivery-qa crew to pick up.

- **Crew-flow reference:** `docs/crew-flows/delivery-build.md`
- **Product strategy:** `docs/product/product.md`
- **AGENTS.md:** `AGENTS.md`
- **Out of scope:** `delivery-review` and `delivery-qa` crews (fast-follow);
  QA remediation re-entry path; OTel tracing; Turbo remote cache; durable
  cross-crew orchestration (see `product.md §2 Future`).

---

## 1. Summary

**Where we are.** CREW-66 (Functional and hardening completion) shipped in
full. The workflow sequence (`context-seed → assess-clarification → implement
→ peer review → open-mr → ci-check → in-qa`), structured artefact extraction
from both personas, `createMr()` idempotency, webhook in-flight 429 guard,
diff size caps, and MR IID URL validation are all green — 221/221 unit tests
pass as of 2026-05-06. See section 12 (Completed work) for the full provenance
trail across CREW-60 through CREW-66.

**What's left to ship.** One epic: CREW-67 (End-to-end validation and
operations). The workflow is functionally complete; CREW-67 adds the
operational handles — pre-flight diagnostics, structured cost logging, a
richer `/healthz` endpoint, an operations runbook — and the end-to-end smoke
test that validates the slice against a real Jira board and GitLab project.

**Critical path.** CREW-67-001 (diagnostics) and CREW-67-002 (cost log) are
the last prerequisite stories before the smoke test. CREW-67-003 (healthz)
and CREW-67-004 (runbook) are independently parallelisable. CREW-67-005 is
the gate: it blocks until the rest of CREW-67 is in place, then executes a
real story end-to-end and produces the acceptance evidence.

**Deferred.** `tech-lead` persona (delivery-review crew), `code-quality`
persona (delivery-qa crew), QA remediation re-entry, OTel tracing, Turbo
remote cache, shared cross-persona memory. See section 13 (Future backlog).

---

## 2. Conventions

| Convention | Value |
| --- | --- |
| Epic ID format | `CREW-{nn}` (continuing from 66) |
| Story ID format | `CREW-{nn}-{nnn}` |
| Status values | Not started, In progress, Done, Blocked |
| Priority levels | P0 (blocks e2e run), P1 (reliability/observability), P2 (quality/docs) |
| Estimation | Fibonacci story points (1, 2, 3, 5, 8) |
| Acceptance format | EARS + Gherkin |

---

## 3. Epic breakdown

| Epic | Title | Phase | Priority | Deps | Points | WP path | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CREW-66 | Functional and hardening completion | Now | P0 | — | 16 | `crews/delivery-build` | Done |
| CREW-67 | End-to-end validation and operations | Now | P0 | CREW-66 | 12 | `crews/delivery-build` | Not started |
| **Total** | | | | | **28** | | |

---

## 4. Epic detail

---

### CREW-67 -- End-to-end validation and operations

**Scope.** Add the operational handles needed to deploy, monitor, and validate
the slice end-to-end. The epic ends with a real story executed on a real Jira
board against a real GitLab project — the gate that proves the slice is
shippable. This epic intentionally stays minimal: the goal is "shippable
end-to-end", not "fully observable at scale".

**Key deliverables.** A pre-flight diagnostics command that verifies
configuration against the real Jira board and GitLab project before the server
binds; a per-story cost summary log emitted on workflow completion; the
`/healthz` endpoint extended with poller and in-flight state; an operations
runbook covering deploy, monitor, and recover; the first end-to-end story run
captured as a smoke test report.

**Dependencies.** CREW-66 (the workflow must be functional and idempotent
before it is exercised against a real board). CREW-67-001 and CREW-67-002 are
prerequisites for the smoke test (CREW-67-005). CREW-67-003 depends on
CREW-66-005 (shipped). CREW-67-004 depends on CREW-67-001, CREW-67-002, and
CREW-67-003. All five stories within this epic are otherwise independent.

**Status.** Not started.

**Work-package path.** `crews/delivery-build` (operational and validation
work; no separate WP design doc).

---

- [ ] **[CREW-67-001] Pre-flight diagnostics command**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-67 | **Labels:** type:feature, type:operations
  - **Depends on:** —
  - **Deliverable:** New `crews/delivery-build/src/diagnostics.ts` exporting
    a `runDiagnostics(config: Config)` function and a `pnpm diagnose` script
    in `crews/delivery-build/package.json` that loads the config, runs the
    diagnostics, and prints a coloured pass/fail report. Each check returns
    `{ name, ok, detail }` and they cover, in order: (1) Jira API
    reachability via `searchIssues("ORDER BY created DESC")` returning a
    `200`; (2) Jira project key exists by querying
    `GET /rest/api/3/project/{JIRA_PROJECT_KEY}`; (3) the four expected
    transition names (`In Progress`, `Clarification Needed`, `In QA`,
    `Needs human review`) are available on the first issue returned by the
    project search; (4) GitLab API reachability via
    `GET /projects/{GITLAB_PROJECT_ID}`; (5) MCP server processes boot
    successfully (spawn each, wait for the initial handshake, kill);
    (6) `DB_PATH` directory is writable. Any failure exits with code 1 and
    prints the failing check's `detail`. The `boot()` function in `index.ts`
    does not call `runDiagnostics` automatically — it is an operator-driven
    command.
  - **Acceptance (EARS):**
    - WHEN `pnpm diagnose` is run with a complete `.env`, THE SYSTEM SHALL
      execute every check and print a summary with one line per check.
    - WHEN any check fails, THE SYSTEM SHALL exit with code 1 and the final
      summary line SHALL state which checks failed.
    - WHEN every check passes, THE SYSTEM SHALL exit with code 0.
    - WHEN one of the four expected Jira transitions is not available on the
      probed issue, THE SYSTEM SHALL fail the transitions check and list the
      missing transition names.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Diagnostics pass on a properly configured environment
      Given a .env with valid Jira and GitLab credentials
      And a board configured with the four expected statuses
      When pnpm diagnose is run
      Then the exit code is 0
      And the summary lists six passing checks

    Scenario: Diagnostics fail when a transition is missing
      Given the Jira board lacks the "Clarification Needed" transition
      When pnpm diagnose is run
      Then the exit code is 1
      And the transitions check is reported as failed with "Clarification Needed" named as missing

    Scenario: Diagnostics fail when GitLab project is unreachable
      Given an invalid GITLAB_PERSONAL_ACCESS_TOKEN
      When pnpm diagnose is run
      Then the exit code is 1
      And the GitLab reachability check is reported as failed
    ```

---

- [ ] **[CREW-67-002] Per-story cost summary log on workflow completion**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-67 | **Labels:** type:observability
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/workflow.ts` emits a single
    `workflow.complete` `info`-level log entry at every terminal exit point
    (`in-qa` handoff, `Needs human review` escalation, clarification halt).
    The log payload aggregates from `state.getStepHistory(issueKey)` and
    contains: `issueKey`, `terminalStep`, `success: boolean`,
    `totalCostUsd: number` (sum of `cost_usd` across steps), `stepCount`,
    `agentSteps` (`{ step: string; sessionId: string; costUsd: number }`
    array, only steps where `session_id IS NOT NULL`), `durationMs`
    (now − first step `started_at`), and `mrUrl` (if any). The same payload
    shape is emitted on escalation paths so cost can be attributed to
    abandoned runs. The log is the foundation for `product.md §7` autonomy
    rate and cost-per-run metrics.
  - **Acceptance (EARS):**
    - WHEN `runStory()` reaches the `In QA` handoff, THE SYSTEM SHALL emit a
      single `workflow.complete` info log with `success: true` and a
      `totalCostUsd` summed across all step rows for the issueKey.
    - WHEN `runStory()` escalates to `Needs human review`, THE SYSTEM SHALL
      emit a `workflow.complete` info log with `success: false` and the same
      cost summary.
    - WHEN the workflow halts at `Clarification Needed`, THE SYSTEM SHALL
      emit a `workflow.complete` info log with `terminalStep:
      "clarification-pending"` and the cost incurred so far.
    - WHEN no agent steps have run, THE SYSTEM SHALL emit `totalCostUsd: 0`
      and `agentSteps: []` rather than omitting the fields.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Successful run logs cost summary
      Given a story that runs implement, peer-code-review, open-mr, ci-check, in-qa
      And implement.cost_usd is 0.50 and address-feedback.cost_usd is 0.20
      When the workflow reaches the In QA transition
      Then a workflow.complete info log is emitted
      And the payload's totalCostUsd is 0.70
      And the payload's success is true
      And the payload contains an agentSteps array with sessionId and costUsd per agent step

    Scenario: Escalation logs cost summary too
      Given a story whose refactor loop cap is exceeded after two address-feedback passes
      When the workflow escalates to Needs human review
      Then a workflow.complete info log is emitted with success: false
      And totalCostUsd reflects all agent step costs incurred

    Scenario: Clarification halt logs partial cost summary
      Given a story whose engineer returns questionsRequired: true
      When the workflow halts at Clarification Needed
      Then a workflow.complete info log is emitted with terminalStep "clarification-pending"
    ```

---

- [ ] **[CREW-67-003] Health endpoint exposes poller state and in-flight count**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 2
  - **Epic:** CREW-67 | **Labels:** type:observability
  - **Depends on:** CREW-66-005 (shipped)
  - **Deliverable:** `crews/delivery-build/src/index.ts` `/healthz` endpoint
    returns
    `{ ok: true, schemaVersion, poller: { lastTickAt, lastTickStatus,
    inFlightCount, inFlight: string[] }, db: { ok, path } }`. The poller
    publishes its `lastTickAt` and `lastTickStatus` ("ok" | "error") into a
    small in-memory state object exported alongside the `inFlight` set
    (shipped in CREW-66-005). The DB check runs `SELECT 1` against the SQLite
    connection and reports `ok: false` if the query throws. The HTTP response
    remains `200 OK` regardless — operators read the structured body — to
    avoid Railway's healthcheck bouncing the container on transient DB
    hiccups. A new `tests/healthz.test.ts` covers the happy path, a failed DB
    check, and a stale `lastTickAt`.
  - **Acceptance (EARS):**
    - WHEN `/healthz` is requested, THE SYSTEM SHALL return HTTP 200 with a
      JSON body containing `ok`, `schemaVersion`, `poller`, and `db`.
    - WHEN the poller has executed at least one tick, THE SYSTEM SHALL include
      `lastTickAt` (ms epoch) and `lastTickStatus` in the response.
    - WHEN one or more workflows are in flight, THE SYSTEM SHALL include
      `inFlightCount` and `inFlight` (issueKey array) reflecting the shared
      in-flight set from CREW-66-005.
    - WHEN the SQLite connection is healthy, THE SYSTEM SHALL set `db.ok` to
      `true` and include `db.path` in the response.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: /healthz includes poller and db state
      Given the poller has executed two ticks
      And one workflow is in flight for "CREW-67-003"
      When GET /healthz is requested
      Then the response is HTTP 200
      And the body contains lastTickStatus "ok"
      And the body contains inFlightCount 1 with inFlight ["CREW-67-003"]
      And the body contains db.ok true

    Scenario: /healthz reflects DB outage
      Given the SQLite connection throws on SELECT 1
      When GET /healthz is requested
      Then the response is HTTP 200
      And the body contains db.ok false
    ```

---

- [ ] **[CREW-67-004] Operations runbook for delivery-build**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 2
  - **Epic:** CREW-67 | **Labels:** type:docs
  - **Depends on:** CREW-67-001, CREW-67-002, CREW-67-003
  - **Deliverable:** New `docs/runbook/delivery-build.md` covering: (1)
    pre-deploy checklist that walks through `pnpm diagnose` against the
    target environment; (2) Railway deploy steps with the exact env vars
    the service requires (cross-link `crews/delivery-build/README.md` rather
    than restating); (3) post-deploy smoke test (verify `/healthz`, verify a
    poll tick log appears within `POLL_INTERVAL_MS`); (4) monitoring guide
    listing the structured log events to alert on (`workflow.escalate`,
    `poller.search-error`, `recovery.session-failed`, `workflow.complete`
    with `success: false`); (5) recovery procedures for the three failure
    modes the system already handles (in-flight on boot, clarification
    timeout, refactor cap reached) plus the SQLite volume-loss path; (6)
    cost controls — how to set `REFACTOR_LOOP_CAP`, `CI_RETRY_CAP`, and
    `CLARIFICATION_TIMEOUT_HOURS` against the cost budget. The runbook
    references `docs/crew-flows/delivery-build.md` for the canonical
    sequence.
  - **Acceptance (EARS):**
    - WHEN `docs/runbook/delivery-build.md` is read, THE SYSTEM SHALL contain
      numbered sections for pre-deploy, deploy, post-deploy smoke test,
      monitoring, recovery, and cost controls.
    - WHEN the runbook references an env var, THE SYSTEM SHALL link to the
      env var's documented row in `crews/delivery-build/README.md` rather
      than restating the description.
    - WHEN the runbook references the workflow sequence, THE SYSTEM SHALL
      cross-reference `docs/crew-flows/delivery-build.md` rather than
      narrating it inline.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Runbook contains all six required sections
      Given the runbook is read
      When the section headings are inspected
      Then sections for "Pre-deploy", "Deploy", "Smoke test", "Monitoring", "Recovery", and "Cost controls" are present

    Scenario: Runbook does not duplicate env var documentation
      Given the runbook references CI_RETRY_CAP
      When the reference is followed
      Then it links to crews/delivery-build/README.md rather than describing the variable inline
    ```

---

- [ ] **[CREW-67-005] First end-to-end story run on real Jira and GitLab**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 3
  - **Epic:** CREW-67 | **Labels:** type:validation, e2e-blocker
  - **Depends on:** CREW-67-001, CREW-67-002
  - **Deliverable:** A real Jira story is taken end-to-end through the
    `delivery-build` slice on a sandboxed Jira project and a sandboxed GitLab
    project. The story is small and well-specified (single-file change, AC
    stated as EARS). Capture: the Jira issue link; the `pnpm diagnose` output;
    the run's structured logs from the Railway deploy (poll tick,
    context-seed, assess-clarification, implement, peer-code-review pass,
    open-mr, ci-check pass, in-qa transition); the resulting MR URL; the
    `workflow.complete` cost summary; the time from polled-pickup to In QA.
    Save the report under `docs/reviews/2026-Q2-delivery-build-e2e.md`. The
    report explicitly notes any deviations from the documented sequence in
    `docs/crew-flows/delivery-build.md`. If the run escalates, the report
    documents the cause and at least one follow-up story is filed against a
    new epic (or against CREW-67 if the cause maps to an existing story scope).
  - **Acceptance (EARS):**
    - WHEN the e2e run completes, THE SYSTEM SHALL transition the test issue
      to `In QA` and the MR's pipeline SHALL be green.
    - WHEN the run completes, THE SYSTEM SHALL emit the `workflow.complete`
      info log captured in `docs/reviews/2026-Q2-delivery-build-e2e.md`.
    - WHEN the e2e report is filed, THE SYSTEM SHALL include the issue link,
      MR URL, total cost in USD, total duration, and a copy of the structured
      log line for each step transition.
    - WHEN the run does not reach `In QA`, THE SYSTEM SHALL escalate to
      `Needs human review` and the report SHALL document the cause and at
      least one follow-up story.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: First e2e run reaches In QA
      Given a small, well-specified Jira story on the sandbox project
      And the delivery-build service is deployed and pnpm diagnose has passed
      When the poller picks up the story on its next tick
      Then the workflow runs context-seed, assess-clarification, implement, peer-code-review, open-mr, ci-check
      And the Jira issue transitions to In QA
      And a workflow.complete info log is emitted with success: true
      And docs/reviews/2026-Q2-delivery-build-e2e.md is filed with the issue link, MR URL, and cost summary

    Scenario: First e2e run escalates -- gap is recorded
      Given a story that triggers an escalation path
      When the workflow transitions to Needs human review
      Then docs/reviews/2026-Q2-delivery-build-e2e.md documents the cause
      And at least one follow-up story is filed referencing the cause
    ```

---

## 5. Dependency graph

```text
CREW-67 (End-to-end validation and operations)
  +-- CREW-67-001 (pre-flight diagnostics) --------+
  |                                                 |
  +-- CREW-67-002 (cost summary log) --------------+---> CREW-67-005 (e2e run)
  |                                                 |
  +-- CREW-67-003 (healthz state)                  |
  |     (after CREW-66-005, shipped)                |
  |                                                 |
  +-- CREW-67-004 (runbook)
        (after CREW-67-001 + CREW-67-002 + CREW-67-003)
```

CREW-67-003 and CREW-67-004 are off the critical path. CREW-67-005 gates on
CREW-67-001 and CREW-67-002 only.

## 6. Critical path

```text
CREW-67-001 (pre-flight diagnostics)
  → CREW-67-002 (cost summary log)
  → CREW-67-005 (first e2e run on real Jira + GitLab)
```

CREW-67-003 and CREW-67-004 are parallelisable around the critical path.

## 7. Parallelisation

All five CREW-67 stories may start simultaneously except for:

- CREW-67-004 must wait for CREW-67-001, CREW-67-002, and CREW-67-003.
- CREW-67-005 must wait for CREW-67-001 and CREW-67-002.

Recommended parallel tracks:

| Track A (critical path) | Track B (independent) |
| --- | --- |
| CREW-67-001 → CREW-67-002 → CREW-67-005 | CREW-67-003 (then feeds CREW-67-004) |

## 8. Minimum viable slice

The smallest set of stories that produces a runnable, observable, end-to-end
delivery-build slice — one that picks up a real story and lands it in `In QA`:

1. **CREW-67-001** — `pnpm diagnose` confirms the target environment before
   the first run.
2. **CREW-67-002** — `workflow.complete` log captures cost and duration so we
   can read what happened.
3. **CREW-67-005** — actually run a story end-to-end.

CREW-67-003 and CREW-67-004 harden visibility and operability but do not block
the smoke test.

## 9. Assumptions

| ID | Assumption | Impact if wrong |
| --- | --- | --- |
| A1 | The engineer and senior-engineer personas consistently emit the JSON artefact envelope specified in each skill's Output contract section (landed in CREW-66-001/002) | If the model regresses to prose output, the parser downgrades the run to `success: false`; tighten the Output contract with an explicit "respond ONLY with the JSON object" terminal instruction |
| A2 | `JIRA_ASSIGNEE_ACCOUNT_ID` is a valid Jira account ID (not display name) usable in JQL `assignee = "..."` | Wrong format causes the poller's JQL to return no results; CREW-67-001 transitions check catches this before deploy |
| A3 | The Jira board exposes the four transition names exactly as written: `In Progress`, `Clarification Needed`, `In QA`, `Needs human review` | `transitionIssue()` silently no-ops on a name miss; CREW-67-001 catches this |
| A4 | The Railway persistent volume at `DB_PATH` survives restarts | Without persistence the SQLite state is ephemeral and the recovery scan is a no-op |
| A5 | The first e2e run uses a sandbox Jira project and GitLab project | Without a sandbox, a failed first run ships visible noise into a production board |

## 10. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Agent does not consistently emit valid JSON in `resultMsg.result`, causing CREW-66-001/002 parsers to downgrade most runs to `success: false` | Medium | High | Tighten the skill's Output contract to say "respond ONLY with the JSON object — no surrounding prose"; as a fallback, parse the longest JSON-shaped substring before failing |
| R2 | `getPipelineStatus` via GitLab MCP returns stale pipeline data due to caching | Low | Medium | Verify response freshness during the e2e run (CREW-67-005); fall back to direct REST call if stale |
| R3 | First e2e run reveals an agent-tool gap (e.g. engineer needs a tool not in the allowlist) | Medium | Medium | The escalation path catches the failure cleanly; CREW-67-005 accepts an escalation outcome and requires a follow-up story rather than treating it as a blocker |
| R4 | Cost-per-run on a real story exceeds expected budget by an order of magnitude | Low | High | CREW-67-002's `workflow.complete` log is the first data point; tighten `REFACTOR_LOOP_CAP` and `CI_RETRY_CAP` defaults if the first run is materially over budget |

## 11. Definition of Done

A story in this backlog is done when:

- [ ] All EARS acceptance statements hold and every Gherkin scenario passes.
- [ ] `pnpm typecheck` passes with zero new errors.
- [ ] `pnpm lint` passes with no new dependency-cruiser violations.
- [ ] `pnpm test` passes with no new failures; new behaviour has ≥ 80% branch
      coverage.
- [ ] New env vars (if any) documented in `crews/delivery-build/.env.example`
      and `crews/delivery-build/README.md`.
- [ ] `AGENTS.md` updated if the repo's public surface or conventions changed.
- [ ] PR merged to `main` via the GitHub Actions CI pipeline.

## 12. Handoff

When CREW-67 closes, the slice has been validated against a real Jira board
and GitLab project, with a runbook and observability in place to operate
unattended.

After CREW-67-005 succeeds:

- `delivery-review` fast-follows with the `tech-lead` persona (final code
  review, MR merge, Jira close).
- `delivery-qa` follows with the `qa-engineer` persona — its trigger is the
  `In QA` transition emitted at the end of `delivery-build`.
- The remediation re-entry path opens once `delivery-qa` exists.
- `product.md §7` autonomy rate and cost-per-run metrics get their first data
  points from CREW-67-002 logs.

---

## 13. Completed work (provenance)

The following epics shipped before this revision and are not re-listed in
section 4. Story-level detail is preserved in git history; this table
summarises the outcome.

| Epic | Title | Outcome | Notes |
| --- | --- | --- | --- |
| CREW-50 | Engineer + senior-engineer SDK wiring | Done | `memory: 'project'`, `buildAuditHook()`, subagent paths, project memory seeding |
| CREW-54 | AGENTS.md + tooling cleanup | Done | Package names normalised |
| CREW-55 | Deferred runtime concerns | Deferred | OTel tracing, Turbo remote cache deferred to Next phase |
| CREW-56 | `@daddia/crew` consolidation | Done | Main entry + `./webhooks` subpath |
| CREW-60 | Jira polling trigger | Done | `searchIssues`, `setInterval` poller, dedup against state + in-flight set |
| CREW-61 | Workflow sequence alignment | Done | `context-seed → assess-clarification → implement → peer-review → open-mr → ci-check → in-qa`; `CI_RETRY_CAP`/`CI_POLL_INTERVAL_MS`; `In QA` handoff; `sessionId` wired into `state.startStep` |
| CREW-62 | Clarification HITL | Done | `assess-clarification` engineer task; `getComments` poller resume; `CLARIFICATION_TIMEOUT_HOURS` |
| CREW-63-001 | Startup env validation | Done | Replaced by zod-driven `loadConfig` + `SchemaValidationError` exit in `boot()` |
| CREW-63-002 | Auth header timing | Done | Header construction moved into `createJiraClient` factory; no module-load-time side effects |
| CREW-63-003 | Crash recovery | Done | `recoverInterruptedSteps()` runs before HTTP server bind |
| CREW-63-005 | Single SQLite connection | Done | `webhook_events` table on the shared state-store handle; no second `DatabaseSync` |
| CREW-63-006 | `finishStep()` filter | Done | `WHERE issue_key = ? AND step = ? AND finished_at IS NULL` |
| CREW-63-008 | In-flight lock (poller side) | Done | Poller owns `inFlight` set; webhook side completed in CREW-66-005 |
| CREW-64-001 | `corepack enable` | Done | `crews/delivery-build/Dockerfile` |
| CREW-64-002 | GitHub Actions CI | Done | `.github/workflows/ci.yml` runs lint, typecheck, test on push and PR to `main` |
| CREW-64-003 | Explicit Dockerfile lockfile COPY | Done | `COPY pnpm-lock.yaml ./` without glob |
| CREW-64-004 | `PROJECT_DIR` and `ANTHROPIC_MODEL` documented | Done | Listed in `.env.example` and `README.md` |
| CREW-64-005 | Test mock cleanup | Done | No `db: {} as never` in `tests/` |
| CREW-64-007 | Loop-bound asymmetry comment | Done | Documented in `workflow.ts` and `AGENTS.md` |
| CREW-65 | Shared crew config primitives + delivery-build adoption | Done | `@daddia/crew/config` subpath (`loadEnv`, `loadYaml`, `Secret`, `redact`, `detectWorkspace`, errors); per-crew `ConfigSchema` + `loadConfig()` in `crews/delivery-build/src/config.ts`; `Config` threaded through integrations, poller, workflow, handlers; boot-time `config.loaded` provenance log and `config.invalid` fast-fail; ESLint rule banning `process.env` outside `config.ts`. Detail in `docs/work/done/crew-config/backlog.md`. |
| CREW-66-001 | Engineer extracts structured artefacts from SDK result | Done | Parses JSON artefact envelope from `resultMsg.result`; emits `branchName`, `title`, `questionsRequired`; falls back to `success: false` on parse failure |
| CREW-66-002 | Senior-engineer extracts structured artefacts from SDK result | Done | Parses `{ verdict, comments }` from `resultMsg.result`; flattens findings to string array; `success: true` on approved |
| CREW-66-003 | Pin MCP server versions in `mcp.json` | Cancelled | Cancelled by product owner |
| CREW-66-004 | Add idempotency guard to `createMr()` | Done | `GET /merge_requests?source_branch=…&state=opened` before `POST`; returns existing URL on hit |
| CREW-66-005 | Webhook handlers return 429 when issueKey is in flight | Done | Shared `in-flight.ts` module; `acquire/release` in poller and both handlers; HTTP 429 on conflict |
| CREW-66-006 | Cap `getMrDiff()` by file count and byte size | Done | `DIFF_FILE_CAP` (default 50) and `DIFF_SIZE_CAP_BYTES` (default 500 000) with truncation notes |
| CREW-66-007 | Validate `extractMrIid()` URL project path | Done | Throws `GitLabUrlError` on project path mismatch or missing `/merge_requests/` segment |

---

## 14. Future backlog

### F-01 -- Shared team memory across personas

Each persona currently writes to its own `memory: 'project'` directory. After
three or more stories complete end-to-end, add a shared read path so the
engineer can see patterns the senior engineer has flagged without direct
inter-persona communication.

**Priority.** Post-operational. Depends on CREW-67 completing.

---

### F-02 -- Remediation re-entry path

Delivery-build v2: the poller picks up `In Remediation` + `qa-remediation`
label tickets, reads QA defect notes, fixes on branch, re-runs CI, removes the
label, and re-transitions to `In QA`. Requires the `delivery-qa` crew to exist.

**Priority.** After `delivery-qa` ships.

---

### F-03 -- `delivery-review` crew

`tech-lead` persona: architecture gate, PM HITL pause, MR approval + merge,
Jira close. Triggered by polling `In QA` tickets (or `ready-for-review`
signal from `delivery-qa`).

**Priority.** Fast-follow once CREW-67-005 demonstrates the slice.

---

### F-04 -- Observability stack

OpenTelemetry tracing across the workflow, structured log shipping to a managed
log store, dashboards keyed on `workflow.complete` and `workflow.escalate`.
Currently CREW-67-002's structured log is the substitute. Move to a real
telemetry stack once a second crew is operating and per-crew dashboards are
needed.

**Priority.** Next phase, once two or more crews are running.

---

### F-05 -- Durable cross-crew orchestration

Per `product.md §2 Future`: a coordination layer above individual crews for
fan-out, fan-in, and pipelines that span hours or days. This sits above
`delivery-build`, `delivery-qa`, and `delivery-review` rather than inside any
of them.

**Priority.** Future phase. Out of scope until at least three crews are in
production.
