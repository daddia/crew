---
type: Backlog
scope: product
product: crew-runtime
version: '2.0'
owner: daddia
status: Active
last_updated: 2026-05-06
related:
  - docs/crew-flows/delivery-build.md
  - AGENTS.md
---

# Backlog -- Delivery-Build Slice

Objective: ship `delivery-build` as a working end-to-end slice. The crew picks
up a Jira story via polling, clarifies ambiguities with the PM, implements it on
a branch, drives it through peer review and CI, and hands off to `In QA` for the
delivery-qa crew to pick up.

- **Crew-flow reference:** `docs/crew-flows/delivery-build.md`
- **AGENTS.md:** `AGENTS.md`
- **Out of scope:** `delivery-review` and `delivery-qa` crews (fast-follow);
  QA remediation re-entry path; OTel tracing; Turbo remote cache

---

## 1. Summary

**Objective.** Make `delivery-build` end-to-end testable against a real Jira
board and GitLab project. The critical path is: polling trigger → workflow
realignment (new sequence, CI gate, In QA handoff) → clarification HITL. A
parallel correctness/infra stream (CREW-63, CREW-64) fixes the issues identified
in the 2026-05-04 solution review that must be resolved before the system runs
safely unattended.

**Prerequisites (complete).** The following work shipped before this backlog was
written and does not require stories:

- `packages/crew` consolidation (`@daddia/crew` + `@daddia/crew/webhooks`) —
  CREW-56-001–005
- `engineer` and `senior-engineer` personas wired to the Claude Agent SDK with
  `memory: 'project'`, `buildAuditHook()`, subagent paths, and project memory
  seeding — CREW-50-002, 003, 006, 007
- `delivery-build` integrations: Jira thin client, GitLab thin client
- `delivery-build` state store: SQLite schema with `stories`, `steps`, and
  `webhook_events` tables
- `delivery-build` webhook handler: `POST /webhooks/jira` and
  `POST /webhooks/gitlab` (secondary trigger — remains in place)
- `AGENTS.md` package names, tooling cleanup — CREW-54-001, 003, 004

**Delivery approach.** CREW-60 and CREW-61 are the critical path and must land
before CREW-62 is useful. CREW-63 and CREW-64 are independent and can proceed in
parallel with the trigger and workflow epics.

**Deferred.** `tech-lead` persona (delivery-review crew), `code-quality` persona
(delivery-qa crew), QA remediation re-entry, OTel tracing (CREW-55-001), Turbo
remote cache (CREW-55-006).

---

## 2. Conventions

| Convention | Value |
| --- | --- |
| Epic ID format | `CREW-{nn}` (continuing from 60) |
| Story ID format | `CREW-{nn}-{nnn}` |
| Status values | Not started, In progress, In review, Done, Blocked |
| Priority levels | P0 (blocking), P1 (reliability), P2 (quality) |
| Estimation | Fibonacci story points (1, 2, 3, 5, 8) |
| Acceptance format | EARS + Gherkin |

---

## 3. Epic breakdown

| Epic | Title | Priority | Deps | Points | Status |
| --- | --- | --- | --- | --- | --- |
| CREW-60 | Jira polling trigger | P0 | — | 5 | Not started |
| CREW-61 | Workflow sequence alignment | P0 | CREW-60 | 9 | done |
| CREW-62 | Clarification HITL step | P1 | CREW-61 | 4 | Not started |
| CREW-63 | Correctness and reliability carry-forward | P1 | — | 18 | In progress |
| CREW-64 | CI/deploy and code quality | P2 | — | 10 | Not started |
| **Total** | | | | **46** | |

---

## 4. Epic detail

---

### CREW-60 -- Jira polling trigger

**Scope.** Replace the webhook as the primary trigger with a scheduled Jira
poller. Every `POLL_INTERVAL_MS` milliseconds the crew queries Jira for `To Do`
stories assigned to the configured engineer and calls `runStory()` for each
eligible result. The webhook handler remains in place as a secondary entry point.

**Key deliverables.** `crews/delivery-build/src/index.ts` starts a
`setInterval`-based poller on boot; `integrations/jira.ts` gains a
`searchIssues(jql)` function; the poller checks the state store before
triggering to avoid double-processing; new env vars `JIRA_PROJECT_KEY`,
`JIRA_ASSIGNEE_ACCOUNT_ID`, and `POLL_INTERVAL_MS` added to `.env.example`.

**Dependencies.** None.

**Status.** Not started.

---

- [ ] **[CREW-60-001] Implement scheduled Jira poller**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 3
  - **Epic:** CREW-60 | **Labels:** type:feature
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/integrations/jira.ts` gains a
    `searchIssues(jql: string)` function that calls
    `/rest/api/3/issue/search?jql=<encoded>` and returns an array of
    `{ issueKey: string }` objects. `crews/delivery-build/src/index.ts` starts
    a `setInterval` loop on boot with interval `POLL_INTERVAL_MS` (default
    300 000 ms). Each tick calls `searchIssues` with the JQL
    `project = "${JIRA_PROJECT_KEY}" AND status = "To Do" AND assignee =
    "${JIRA_ASSIGNEE_ACCOUNT_ID}"`, iterates the results, and calls
    `runStory({ issueKey, state })` asynchronously for each eligible story. The
    poller logs a `warn`-level message and continues on Jira API errors without
    crashing. The interval is cleared in the existing SIGTERM/SIGINT shutdown
    handlers.
  - **Acceptance (EARS):**
    - WHEN the delivery agent starts, THE SYSTEM SHALL begin polling Jira every
      `POLL_INTERVAL_MS` milliseconds for `To Do` stories assigned to
      `JIRA_ASSIGNEE_ACCOUNT_ID` in `JIRA_PROJECT_KEY`.
    - WHEN a Jira poll returns eligible stories, THE SYSTEM SHALL call
      `runStory()` asynchronously for each result.
    - WHEN `POLL_INTERVAL_MS` is not set, THE SYSTEM SHALL default to `300000`.
    - WHEN the Jira search request fails, THE SYSTEM SHALL log a `warn`-level
      message and retry on the next scheduled tick without crashing the server.
    - WHEN the delivery agent receives SIGTERM or SIGINT, THE SYSTEM SHALL clear
      the poll interval before closing.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Poller discovers a new To Do story and triggers workflow
      Given JIRA_PROJECT_KEY is "CREW" and JIRA_ASSIGNEE_ACCOUNT_ID is "user-123"
      And Jira contains one To Do story "CREW-60-001" assigned to "user-123"
      When the poll interval fires
      Then a JQL search is executed for project = "CREW" AND status = "To Do" AND assignee = "user-123"
      And runStory() is called with issueKey "CREW-60-001"

    Scenario: Poller defaults to 5-minute interval
      Given POLL_INTERVAL_MS is not set
      When the delivery agent starts
      Then the poll interval is 300000 milliseconds

    Scenario: Jira poll failure is logged and retried
      Given the Jira API returns a 500 error on a poll tick
      When the poll fires
      Then a warn-level log is emitted with the error
      And the server continues running
      And the next poll tick is scheduled normally

    Scenario: Poller stops on SIGTERM
      Given the delivery agent is running with an active poll interval
      When SIGTERM is received
      Then the poll interval is cleared before the server closes
    ```

---

- [ ] **[CREW-60-002] Deduplication guard in poller**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 2
  - **Epic:** CREW-60 | **Labels:** type:reliability
  - **Depends on:** CREW-60-001
  - **Deliverable:** Inside the poller tick, before calling `runStory()`, the
    code calls `state.getStory(issueKey)`. If the story exists and its
    `currentStep` is not a terminal value (`in-qa`, `needs-human-review`), the
    issueKey is skipped and a `debug`-level log is emitted. The in-flight lock
    map from CREW-63-008 is also checked: if the issueKey is already locked, the
    story is skipped. Terminal stories from the Jira query are silently ignored
    (they were transitioned but Jira has not yet removed them from the board).
    Unit test covers in-progress skip, terminal-step re-skip, and new-story
    trigger paths.
  - **Acceptance (EARS):**
    - WHEN the poller discovers an issueKey that already has a non-terminal step
      record in the state store, THE SYSTEM SHALL skip that issueKey without
      calling `runStory()`.
    - WHEN the poller discovers an issueKey with a terminal step record
      (`in-qa` or `needs-human-review`), THE SYSTEM SHALL skip that issueKey.
    - WHEN the poller discovers an issueKey with an active in-flight lock,
      THE SYSTEM SHALL skip that issueKey.
    - WHEN the poller discovers an issueKey not present in the state store and
      not in-flight, THE SYSTEM SHALL call `runStory()` for that issueKey.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: In-progress story is skipped by poller
      Given a state record exists for issueKey "CREW-60-001" with currentStep "implement"
      When the poller discovers "CREW-60-001" in the Jira results
      Then runStory() is NOT called for "CREW-60-001"

    Scenario: New story triggers runStory
      Given no state record exists for issueKey "CREW-60-002"
      And no in-flight lock exists for "CREW-60-002"
      When the poller discovers "CREW-60-002" in the Jira results
      Then runStory() is called with issueKey "CREW-60-002"

    Scenario: Terminal story is not re-triggered
      Given a state record for "CREW-60-003" with currentStep "in-qa"
      When the poller discovers "CREW-60-003" in the Jira results
      Then runStory() is NOT called for "CREW-60-003"

    Scenario: In-flight story is not triggered a second time
      Given an in-flight lock exists for issueKey "CREW-60-004"
      When the poller discovers "CREW-60-004" in the Jira results
      Then runStory() is NOT called for "CREW-60-004"
    ```

---

### CREW-61 -- Workflow sequence alignment

**Scope.** Realign `workflow.ts` to match `docs/crew-flows/delivery-build.md`.
The current sequence opens the MR before peer review; the correct sequence is
implement → peer review → address feedback → open MR → CI check → In QA. A
context-seeding step reads the full Jira ticket before the engineer starts. The
handoff target changes from `In Review` to `In QA`. The `steps.session_id`
column is populated so crash recovery (CREW-63-003) can resume interrupted runs.

**Key deliverables.** `workflow.ts` with reordered steps; new
`getPipelineStatus(mrUrl)` in `integrations/gitlab.ts`; `Step` type gains
`context-seed`, `ci-fix`, and `in-qa` values; `In Review` transition removed
from the normal path; `CI_RETRY_CAP` and `CI_POLL_INTERVAL_MS` env vars
documented; `sessionId` wired into `state.startStep()` for agent steps.

**Dependencies.** CREW-60 (polling trigger must exist before workflow changes
are testable end-to-end; the workflow itself can be developed in parallel).

**Status.** Complete. All five stories done; workflow sequence aligned with delivery-build flow diagram.

---

- [x] **[CREW-61-001] Reorder workflow: MR opens after peer-review loop**
  - **Status:** done | **Priority:** P0 | **Estimate:** 2
  - **Epic:** CREW-61 | **Labels:** type:correctness
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/workflow.ts` reordered so the
    sequence is: `implement` → `peer-code-review` / `address-feedback` loop →
    `open-mr`. The `createMr()` call moves from before the loop to after it.
    The `Step` type in `state.ts` is reordered to reflect the new logical order.
    The existing `workflow.test.ts` suite updated to match. No new behaviour is
    added beyond the reorder; the escalation path when the loop cap is exceeded
    continues to halt without opening an MR.
  - **Acceptance (EARS):**
    - WHEN `runStory()` executes, THE SYSTEM SHALL call `engineer.run()` for
      implementation and the `seniorEngineer.run()` peer-review loop before
      calling `createMr()`.
    - WHEN the peer-review loop completes with approval, THE SYSTEM SHALL then
      call `createMr()` to open the merge request.
    - WHEN the peer-review loop reaches `REFACTOR_LOOP_CAP` without approval,
      THE SYSTEM SHALL escalate without calling `createMr()`.
    - THE SYSTEM SHALL NOT call `createMr()` before the peer-review loop has
      completed.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: MR is opened after peer review approves
      Given a story where the engineer implements and seniorEngineer approves on first review
      When runStory() runs
      Then seniorEngineer.run() is called before createMr()
      And createMr() is called once after seniorEngineer returns success

    Scenario: MR is not opened when loop cap is exceeded
      Given REFACTOR_LOOP_CAP is 2
      And seniorEngineer always returns success: false
      When runStory() runs
      Then createMr() is never called
      And the story transitions to "needs-human-review"

    Scenario: Workflow order is implement then peer-review then MR
      Given a normal story run with no failures
      When runStory() completes
      Then the step sequence recorded in state is: implement, peer-code-review, open-mr
      And createMr() is called after the last seniorEngineer.run() invocation
    ```

---

- [x] **[CREW-61-002] Add context-seeding step before implementation**
  - **Status:** done | **Priority:** P0 | **Estimate:** 2
  - **Epic:** CREW-61 | **Labels:** type:feature
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/integrations/jira.ts` gains a
    `getIssue(issueKey)` function that calls `/rest/api/3/issue/{issueKey}` and
    returns a structured `{ summary, description, acceptanceCriteria }` object.
    `workflow.ts` calls `getIssue(issueKey)` at the start of `runStory()` (after
    the clarification step, CREW-62) and passes the result as `context.ticket`
    in every `AgentInput` sent to `engineer.run()` (both `implement` and
    `address-feedback` tasks). If `getIssue()` fails, a `warn`-level log is
    emitted and the workflow continues with `context.ticket` set to `null`. The
    `Step` type gains a `context-seed` step which is recorded in state before the
    `getIssue()` call.
  - **Acceptance (EARS):**
    - WHEN `runStory()` begins, THE SYSTEM SHALL call `getIssue(issueKey)` and
      pass the result as `context.ticket` to `engineer.run()` for the
      `implement` task.
    - WHEN `getIssue()` fails, THE SYSTEM SHALL log a `warn`-level message and
      proceed with `context.ticket: null` rather than halting the workflow.
    - THE SYSTEM SHALL pass `context.ticket` to every `engineer.run()` call in
      the workflow (both `implement` and `address-feedback` tasks).
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Ticket content is passed to engineer on implementation
      Given a Jira issue "CREW-61-002" with description "Build the feature"
      When runStory() starts
      Then getIssue("CREW-61-002") is called before engineer.run() for implement
      And the engineer's AgentInput.context.ticket contains the issue summary and description

    Scenario: Ticket content is also passed on address-feedback
      Given a peer review cycle that results in feedback
      When engineer.run() is called for the address-feedback task
      Then AgentInput.context.ticket is populated with the issue data

    Scenario: Jira fetch failure does not halt workflow
      Given getIssue() throws a network error
      When runStory() starts
      Then a warn-level log is emitted
      And engineer.run() is still called with context.ticket as null
    ```

---

- [x] **[CREW-61-003] CI pipeline check and fix loop after MR open**
  - **Status:** done | **Priority:** P0 | **Estimate:** 3
  - **Epic:** CREW-61 | **Labels:** type:feature
  - **Depends on:** CREW-61-001
  - **Deliverable:** `crews/delivery-build/src/integrations/gitlab.ts` gains a
    `getPipelineStatus(mrUrl)` function that calls
    `GET /projects/{id}/merge_requests/{iid}/pipelines` and returns the latest
    pipeline's `status` string (`created`, `pending`, `running`, `success`,
    `failed`, `canceled`). `workflow.ts` enters a CI monitoring loop after
    `createMr()`: it polls `getPipelineStatus()` every `CI_POLL_INTERVAL_MS`
    (default 30 000 ms) until the status is `success` or `failed`. On `failed`,
    it calls `engineer.run()` with `task: 'fix-ci'` and `context.ciFailure`
    containing the pipeline status details. The loop is bounded by `CI_RETRY_CAP`
    (default 3); on cap exceeded the workflow escalates. On `success` the loop
    exits and the workflow proceeds to the In QA handoff. `CI_RETRY_CAP` and
    `CI_POLL_INTERVAL_MS` are added to `.env.example`.
  - **Acceptance (EARS):**
    - WHEN an MR is opened, THE SYSTEM SHALL poll `getPipelineStatus(mrUrl)` to
      check the CI pipeline status.
    - WHEN the pipeline status is `success`, THE SYSTEM SHALL exit the CI loop
      and proceed to the In QA handoff.
    - WHEN the pipeline status is `failed`, THE SYSTEM SHALL call
      `engineer.run()` with `task: 'fix-ci'` and pipeline failure details in
      `context.ciFailure`.
    - WHEN the number of CI fix attempts reaches `CI_RETRY_CAP`, THE SYSTEM
      SHALL escalate to human review without attempting another fix.
    - WHEN the pipeline status is `pending` or `running`, THE SYSTEM SHALL wait
      `CI_POLL_INTERVAL_MS` before polling again.
    - WHEN `CI_RETRY_CAP` is not set, THE SYSTEM SHALL default to `3`.
    - WHEN `CI_POLL_INTERVAL_MS` is not set, THE SYSTEM SHALL default to
      `30000`.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: CI passes on first check
      Given an MR whose latest pipeline has status "success"
      When getPipelineStatus() is called
      Then the CI loop exits with success
      And the workflow proceeds to the In QA transition

    Scenario: CI fails and engineer fixes within cap
      Given CI_RETRY_CAP is 3
      And the pipeline status is "failed" on first check then "success" after one fix
      When the CI monitoring loop runs
      Then engineer.run() is called once with task "fix-ci"
      And the loop exits when the pipeline is green

    Scenario: CI fix cap exceeded escalates workflow
      Given CI_RETRY_CAP is 2
      And the pipeline status is always "failed"
      When the CI loop runs
      Then engineer.run() is called exactly 2 times with task "fix-ci"
      And the workflow escalates to human review without a further attempt

    Scenario: Pending pipeline triggers a wait before next poll
      Given the pipeline status is "running"
      When getPipelineStatus() is called
      Then the loop waits CI_POLL_INTERVAL_MS before polling again
    ```

---

- [x] **[CREW-61-004] Change handoff to "In QA" and document new env vars**
  - **Status:** done | **Priority:** P0 | **Estimate:** 1
  - **Epic:** CREW-61 | **Labels:** type:feature
  - **Depends on:** CREW-61-003
  - **Deliverable:** `workflow.ts` calls `transitionIssue(issueKey, "In QA")`
    (replacing the former `"In Review"` call) after the CI pipeline passes. A
    structured `info`-level log is emitted: `workflow.handoff-to-qa` with
    `{ issueKey, mrUrl }`. The `Step` type replaces `in-review` with `in-qa`.
    `crews/delivery-build/.env.example` and `README.md` updated to document
    `CI_RETRY_CAP`, `CI_POLL_INTERVAL_MS`, `JIRA_PROJECT_KEY`,
    `JIRA_ASSIGNEE_ACCOUNT_ID`, `POLL_INTERVAL_MS`, `PROJECT_DIR`, and
    `ANTHROPIC_MODEL` with descriptions and defaults.
  - **Acceptance (EARS):**
    - WHEN the CI pipeline passes, THE SYSTEM SHALL call
      `transitionIssue(issueKey, "In QA")`.
    - WHEN the `In QA` transition succeeds, THE SYSTEM SHALL emit a
      `workflow.handoff-to-qa` info log with `issueKey` and `mrUrl`.
    - THE SYSTEM SHALL NOT call `transitionIssue(issueKey, "In Review")` during
      a normal delivery-build workflow run.
    - WHEN `.env.example` is read, THE SYSTEM SHALL document every env var
      consumed by `crews/delivery-build`, including the new vars from CREW-60
      and CREW-61.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Successful workflow transitions to In QA
      Given a CI-green MR for issueKey "JIRA-123"
      When the CI monitoring loop exits with success
      Then transitionIssue("JIRA-123", "In QA") is called
      And a workflow.handoff-to-qa info log is emitted with issueKey and mrUrl

    Scenario: In Review transition is absent from normal flow
      Given a story that completes the full workflow without escalation
      When runStory() finishes
      Then transitionIssue() is never called with the argument "In Review"

    Scenario: .env.example documents all new env vars
      Given crews/delivery-build/.env.example is read
      When it is searched for CI_RETRY_CAP, CI_POLL_INTERVAL_MS, POLL_INTERVAL_MS,
           JIRA_PROJECT_KEY, JIRA_ASSIGNEE_ACCOUNT_ID, PROJECT_DIR, and ANTHROPIC_MODEL
      Then all seven are present with inline description comments
    ```

---

- [x] **[CREW-61-005] Wire sessionId into `state.startStep()` for agent steps**
  - **Status:** done | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-61 | **Labels:** type:correctness, review:#1
  - **Depends on:** —
  - **Deliverable:** `workflow.ts` passes the `sessionId` from
    `AgentResult.artefacts["sessionId"]` as the third argument to
    `state.startStep()` for the `implement` and `address-feedback` steps. For
    non-agent steps (`open-mr`, `peer-code-review` as a step record, `in-qa`)
    the `sessionId` argument is omitted. The `steps.session_id` column is
    therefore populated for agent-executing steps, enabling crash recovery
    (CREW-63-003) to resume interrupted runs. Unit tests assert the `sessionId`
    argument is passed for agent steps and omitted for non-agent steps.
  - **Acceptance (EARS):**
    - WHEN `state.startStep()` is called for the `implement` step, THE SYSTEM
      SHALL pass the engineer's `sessionId` from
      `AgentResult.artefacts["sessionId"]`.
    - WHEN `state.startStep()` is called for the `address-feedback` step,
      THE SYSTEM SHALL pass the current engineer's `sessionId`.
    - WHEN `state.startStep()` is called for a non-agent step, THE SYSTEM SHALL
      omit the `sessionId` argument.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: sessionId is stored for the implement step
      Given engineer.run() returns an AgentResult with artefacts.sessionId "sess_abc"
      When state.startStep() is called for the "implement" step
      Then the sessionId argument "sess_abc" is passed to startStep

    Scenario: sessionId is stored for the address-feedback step
      Given engineer.run() for address-feedback returns artefacts.sessionId "sess_def"
      When state.startStep() is called for the "address-feedback" step
      Then the sessionId argument "sess_def" is passed to startStep

    Scenario: Non-agent steps do not store sessionId
      Given the workflow records the "open-mr" step
      When state.startStep() is called for "open-mr"
      Then no sessionId argument is passed
    ```

---

### CREW-62 -- Clarification HITL step

**Scope.** Before transitioning a story to `In Progress`, the engineer assesses
whether the ticket has enough information to proceed. If not, it posts structured
questions to Jira, transitions to `Clarification Needed`, and halts. The poller
recognises stories awaiting clarification and resumes them once a PM response
is found, or escalates after `CLARIFICATION_TIMEOUT_HOURS`.

**Key deliverables.** `workflow.ts` calls `engineer.run()` with
`task: 'assess-clarification'` as the first step; `integrations/jira.ts` gains
`getComments(issueKey)`; poller extended to check `clarification-pending`
stories on each tick; `CLARIFICATION_TIMEOUT_HOURS` documented in `.env.example`.

**Dependencies.** CREW-61 (workflow structure must be settled before wiring the
clarification step into it).

**Status.** Not started.

---

- [ ] **[CREW-62-001] Engineer assesses ticket and posts clarifying questions**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-62 | **Labels:** type:feature
  - **Depends on:** CREW-61-002
  - **Deliverable:** As the first action in `runStory()` (before the `In
    Progress` transition), `workflow.ts` calls `engineer.run()` with
    `task: 'assess-clarification'` and `context.ticket` populated from
    `getIssue()`. The engineer returns an `AgentResult` where
    `artefacts.questionsRequired` is `true` and `artefacts.questions` is a
    non-empty string if clarification is needed, or `false` if the ticket is
    clear. When `questionsRequired` is `true`, the workflow calls
    `commentOnIssue(issueKey, questions)`, calls
    `transitionIssue(issueKey, "Clarification Needed")`, records a
    `clarification-pending` step in the state store (via `state.startStep` +
    `state.finishStep`), and returns without proceeding to implementation. When
    `questionsRequired` is `false`, the workflow continues to the `In Progress`
    transition with no comment posted.
  - **Acceptance (EARS):**
    - WHEN `runStory()` starts, THE SYSTEM SHALL call `engineer.run()` with
      `task: 'assess-clarification'` before transitioning the ticket to
      `In Progress`.
    - WHEN the engineer returns `artefacts.questionsRequired: true`, THE SYSTEM
      SHALL post the questions as a Jira comment and transition to
      `Clarification Needed`.
    - WHEN the engineer returns `artefacts.questionsRequired: false`,
      THE SYSTEM SHALL proceed to the `In Progress` transition without posting
      a comment.
    - WHEN clarification is needed, THE SYSTEM SHALL record a
      `clarification-pending` step in the state store and return from
      `runStory()` without calling `engineer.run()` for implementation.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Engineer determines no clarification is needed
      Given a well-specified Jira ticket
      And engineer.run() returns artefacts.questionsRequired: false
      When runStory() starts
      Then commentOnIssue() is not called
      And transitionIssue() is called with "In Progress"
      And the workflow continues to implementation

    Scenario: Engineer posts clarifying questions
      Given an ambiguous Jira ticket
      And engineer.run() returns artefacts.questionsRequired: true
      And artefacts.questions is "What is the expected error behaviour?"
      When runStory() starts
      Then commentOnIssue() is called with the questions text
      And transitionIssue() is called with "Clarification Needed"
      And a clarification-pending step is recorded in state
      And runStory() returns without calling engineer.run() for implementation
    ```

---

- [ ] **[CREW-62-002] Poller resumes clarification-pending stories**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-62 | **Labels:** type:feature
  - **Depends on:** CREW-62-001, CREW-60-001
  - **Deliverable:** `integrations/jira.ts` gains a `getComments(issueKey)`
    function that calls `/rest/api/3/issue/{issueKey}/comment` and returns
    `Array<{ author: string; body: string; created: string }>`. The poller tick
    in `index.ts` checks `state` for stories in `clarification-pending` step.
    For each, it calls `getComments(issueKey)`, finds comments posted after the
    `clarification-pending` step's `started_at` timestamp, and checks whether
    any comment author is not the system bot (i.e., is a human response). If a
    human response is found, it calls `runStory()` to resume from the
    `In Progress` transition. If `CLARIFICATION_TIMEOUT_HOURS` (default 24)
    have elapsed since `started_at` with no human response, the workflow
    escalates to `Needs Human Review` with a timeout explanation.
    `CLARIFICATION_TIMEOUT_HOURS` added to `.env.example`.
  - **Acceptance (EARS):**
    - WHEN the poller runs and finds a story in `clarification-pending` step,
      THE SYSTEM SHALL call `getComments(issueKey)` to check for a human
      response posted after the clarification question.
    - WHEN a human response comment is found, THE SYSTEM SHALL resume the
      workflow by calling `runStory()` for that issueKey.
    - WHEN no human response is found and `CLARIFICATION_TIMEOUT_HOURS` have
      elapsed since `started_at`, THE SYSTEM SHALL escalate the story to
      `Needs Human Review` with a timeout explanation comment.
    - WHEN `CLARIFICATION_TIMEOUT_HOURS` is not set, THE SYSTEM SHALL default
      to `24`.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: PM responds within timeout window
      Given a story "CREW-62-001" in clarification-pending step
      And a Jira comment from a human was posted after the clarification question
      When the poller fires
      Then runStory() is called to resume implementation for "CREW-62-001"

    Scenario: Timeout reached with no PM response
      Given a story "CREW-62-002" in clarification-pending step
      And CLARIFICATION_TIMEOUT_HOURS is 24
      And the clarification-pending step was recorded 25 hours ago
      And no human comment exists after the question
      When the poller fires
      Then escalateToHumanReview() is called for "CREW-62-002"
      And the escalation Jira comment mentions the clarification timeout

    Scenario: Default timeout is 24 hours
      Given CLARIFICATION_TIMEOUT_HOURS is not set
      When the clarification timeout threshold is evaluated
      Then the threshold is 86400000 milliseconds
    ```

---

### CREW-63 -- Correctness and reliability carry-forward

**Scope.** Nine correctness and reliability fixes from the 2026-05-04 solution
review that must be resolved before the system runs safely unattended. These are
independent of the new flow epics and can proceed in parallel.

**Key deliverables.** Startup env validation; auth header moved inside
`jiraFetch()`; crash recovery scan on startup; pinned MCP versions; single
SQLite connection; correct `finishStep()` WHERE clause; `createMr()` idempotency
guard; per-issueKey in-flight lock; `getMrDiff()` size cap.

**Dependencies.** None (all stories are independently mergeable).

**Status.** In progress.

---

- [ ] **[CREW-63-001] Startup env var validation**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-63 | **Labels:** review:#7, type:reliability
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/index.ts` checks all required env
    vars before the Hono server starts: `ANTHROPIC_API_KEY`,
    `ATLASSIAN_BASE_URL`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`,
    `GITLAB_PERSONAL_ACCESS_TOKEN`, `GITLAB_API_URL`, `GITLAB_PROJECT_ID`,
    `JIRA_WEBHOOK_SECRET`, `GITLAB_WEBHOOK_SECRET`, `JIRA_PROJECT_KEY`,
    `JIRA_ASSIGNEE_ACCOUNT_ID`. If any are absent, logs the missing keys at
    `error` level and calls `process.exit(1)` before the server binds.
  - **Acceptance (EARS):**
    - WHEN the server starts and one or more required env vars are absent,
      THE SYSTEM SHALL log the names of all missing vars at `error` level and
      exit with code 1 before accepting any requests.
    - WHEN all required env vars are present, THE SYSTEM SHALL start normally
      without an error-level env validation log.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Missing env var causes immediate exit
      Given ANTHROPIC_API_KEY is not set
      When the delivery agent starts
      Then a structured error log lists "ANTHROPIC_API_KEY" as missing
      And the process exits with code 1 before the server binds

    Scenario: All env vars present -- server starts normally
      Given all required env vars are set to non-empty values
      When the delivery agent starts
      Then no error-level env validation log is emitted
      And the server binds and accepts requests
    ```

---

- [ ] **[CREW-63-002] Move Jira auth header construction inside `jiraFetch()`**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-63 | **Labels:** review:#17, type:reliability
  - **Depends on:** CREW-63-001
  - **Deliverable:** `crews/delivery-build/src/integrations/jira.ts` constant
    `authHeader` moved from module-level scope into the `jiraFetch()` function
    body. The Base64 encoding of credentials is no longer evaluated at import
    time before env validation runs.
  - **Acceptance (EARS):**
    - WHEN `integrations/jira.ts` is imported, THE SYSTEM SHALL NOT evaluate
      `Buffer.from(...).toString("base64")` using env vars at module-load time.
    - WHEN `jiraFetch()` is called, THE SYSTEM SHALL construct the
      `Authorization` header from the current values of `ATLASSIAN_EMAIL` and
      `ATLASSIAN_API_TOKEN` at call time.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Auth header is not evaluated at module load time
      Given jira.ts is imported before env vars are validated
      When the jira.ts module is evaluated
      Then no Buffer.from credential encoding occurs at module scope

    Scenario: jiraFetch constructs the header at call time
      Given ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN are set
      When jiraFetch() is called
      Then the Authorization header encodes the current values of those env vars
    ```

---

- [ ] **[CREW-63-003] Crash recovery: resume interrupted steps on startup**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-63 | **Labels:** review:#8, type:reliability
  - **Depends on:** CREW-61-005
  - **Deliverable:** `crews/delivery-build/src/index.ts` on startup calls a new
    `recoverInterruptedSteps(state)` function that queries the `steps` table for
    rows where `finished_at IS NULL` and `session_id IS NOT NULL`. For each such
    row, it calls `unstable_v2_resumeSession(sessionId)` from
    `@anthropic-ai/claude-agent-sdk` to reconnect to the interrupted SDK
    session, then calls `runStory({ issueKey, state })` to resume the workflow.
    On resumption failure, it logs a `warn`-level message and calls
    `escalateToHumanReview()`. The recovery scan runs before the HTTP server
    starts accepting requests and before the poller interval is set up.
  - **Acceptance (EARS):**
    - WHEN the server starts and the `steps` table contains rows with
      `finished_at IS NULL AND session_id IS NOT NULL`, THE SYSTEM SHALL
      attempt to resume each interrupted step via `unstable_v2_resumeSession`.
    - WHEN the server starts and no interrupted steps exist, THE SYSTEM SHALL
      complete the scan without a `warn` or `error` log.
    - WHEN the recovery scan successfully reconnects a session, THE SYSTEM SHALL
      log at `info` level the `issueKey`, `step`, and `sessionId`.
    - WHEN `unstable_v2_resumeSession` fails for a recovered row, THE SYSTEM
      SHALL log a `warn`-level message and escalate that story to human review.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Interrupted step is resumed on startup
      Given a steps row for "CREW-63-001" with step "implement", finished_at null, session_id "sess_abc"
      When the delivery agent restarts
      Then unstable_v2_resumeSession("sess_abc") is called
      And an info log is emitted with issueKey "CREW-63-001" and session_id "sess_abc"

    Scenario: No interrupted steps -- scan exits silently
      Given the steps table has no rows with finished_at null
      When the delivery agent starts
      Then the recovery scan completes without any warn or error log

    Scenario: Session resumption failure escalates to human review
      Given a steps row with session_id "sess_gone"
      And unstable_v2_resumeSession("sess_gone") throws an error
      When the recovery scan runs
      Then a warn-level log is emitted
      And the story is transitioned to "Needs Human Review"
    ```

---

- [ ] **[CREW-63-004] Pin MCP server versions in `mcp.json`**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-63 | **Labels:** review:#9, type:reliability
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/mcp.json` updated so
    `@anthropic-ai/mcp-server-atlassian` and `@anthropic-ai/mcp-server-gitlab`
    are referenced with explicit version strings (e.g.
    `@anthropic-ai/mcp-server-gitlab@1.2.3`). `npx -y` no longer downloads the
    latest version on every agent invocation.
  - **Acceptance (EARS):**
    - WHEN `mcp.json` is read, THE SYSTEM SHALL reference each MCP server
      package with an explicit version string.
    - WHEN a new version of either package is published, THE SYSTEM SHALL NOT
      automatically upgrade unless the version string in `mcp.json` is
      explicitly updated.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: MCP server args include pinned version
      Given crews/delivery-build/mcp.json
      When the args array for mcp-server-gitlab is inspected
      Then the package name includes a version specifier (e.g. @1.2.3)

    Scenario: Unpinned package name is absent
      Given mcp.json is read
      When it is checked for unversioned package references
      Then no entry reads "@anthropic-ai/mcp-server-gitlab" without a version
    ```

---

- [ ] **[CREW-63-005] Consolidate dual SQLite connections**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-63 | **Labels:** review:#5, type:reliability
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/idempotency.ts`
    `getIdempotency()` no longer opens a second `DatabaseSync` connection to
    `DB_PATH`. Instead the `db` instance from `createStateStore()` is passed
    into `createIdempotencyStore()` (or the idempotency logic is merged into the
    state store). At runtime there is exactly one `DatabaseSync` connection to
    `DB_PATH` and the `webhook_events` table is created once.
  - **Acceptance (EARS):**
    - WHEN the delivery agent starts, THE SYSTEM SHALL open exactly one
      `DatabaseSync` connection to `DB_PATH`.
    - WHEN both the state store and idempotency store are initialised,
      THE SYSTEM SHALL share the same underlying `DatabaseSync` instance.
    - WHEN the `webhook_events` table schema runs, THE SYSTEM SHALL execute the
      `CREATE TABLE IF NOT EXISTS webhook_events` statement exactly once.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Only one database connection is opened
      Given DB_PATH is set to a valid file path
      When the delivery agent initialises both the state store and idempotency store
      Then only one DatabaseSync connection to DB_PATH is created

    Scenario: webhook_events table is created once
      Given the shared connection is used for both state and idempotency
      When the schema runs
      Then CREATE TABLE IF NOT EXISTS webhook_events executes exactly once
    ```

---

- [ ] **[CREW-63-006] Fix `finishStep()` to filter on `step` column**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-63 | **Labels:** review:#6, type:correctness
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/state.ts` `finishStepStmt` SQL
    updated from
    `WHERE issue_key = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1`
    to `WHERE issue_key = ? AND step = ? AND finished_at IS NULL`. `finishStep()`
    passes `step` as the second bind parameter. The `void step` comment is
    removed. A unit test covering the two-step replay scenario confirms the
    correct row is updated.
  - **Acceptance (EARS):**
    - WHEN `finishStep(issueKey, step, result)` is called, THE SYSTEM SHALL
      update the `steps` row matching both `issue_key = issueKey` AND
      `step = step` with `finished_at IS NULL`.
    - WHEN two steps for the same `issueKey` are both unfinished, THE SYSTEM
      SHALL update the correct row as specified by the `step` argument.
    - THE SYSTEM SHALL NOT silently discard the `step` argument.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: finishStep updates the correct row
      Given steps rows for "CREW-63" with step "implement" (unfinished) and "peer-code-review" (unfinished)
      When finishStep("CREW-63", "peer-code-review", { verdict: "approved" }) is called
      Then the "peer-code-review" row has finished_at set
      And the "implement" row still has finished_at null

    Scenario: step argument is not discarded
      Given a finishStep call with step "implement"
      When the UPDATE statement executes
      Then the WHERE clause includes step = "implement"
    ```

---

- [ ] **[CREW-63-007] Add idempotency guard to `createMr()`**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-63 | **Labels:** review:#10, type:correctness
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/integrations/gitlab.ts`
    `createMr()` calls
    `GET /projects/{id}/merge_requests?source_branch={branchName}&state=opened`
    before `POST /merge_requests`. If an open MR already exists for the branch,
    the function returns the existing MR's `web_url` without creating a
    duplicate. Unit tests cover the existing-MR path and the no-existing-MR
    path.
  - **Acceptance (EARS):**
    - WHEN `createMr()` is called and an open MR already exists for
      `branchName`, THE SYSTEM SHALL return the existing MR's `web_url` without
      issuing a `POST /merge_requests` request.
    - WHEN `createMr()` is called and no open MR exists for `branchName`,
      THE SYSTEM SHALL proceed with `POST /merge_requests` and return the new
      MR's `web_url`.
    - WHEN the `GET /merge_requests` lookup fails, THE SYSTEM SHALL propagate
      the error rather than silently creating a duplicate MR.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Existing MR is returned without duplicate POST
      Given an open MR exists for branch "feat/CREW-63-007"
      When createMr() is called with that branchName
      Then GET /merge_requests?source_branch=feat/CREW-63-007 is called
      And no POST /merge_requests request is issued
      And the existing MR's web_url is returned

    Scenario: No existing MR -- new MR is created
      Given no open MR exists for branch "feat/CREW-63-007"
      When createMr() is called
      Then the GET lookup returns an empty list
      And POST /merge_requests is issued
      And the new MR's web_url is returned

    Scenario: GET lookup failure propagates as error
      Given the GitLab API returns 500 for the GET lookup
      When createMr() is called
      Then the error is propagated to the caller
      And no POST /merge_requests is issued
    ```

---

- [ ] **[CREW-63-008] Per-issueKey in-flight lock**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-63 | **Labels:** review:#20, type:reliability
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/workflow.ts` exports an
    in-memory `Map<string, boolean>` named `inFlightLocks`. `runStory()` sets
    `inFlightLocks.set(issueKey, true)` before the workflow starts and deletes
    the key in a `finally` block when it completes or throws. The webhook
    handlers and poller check `inFlightLocks.has(issueKey)` before calling
    `runStory()`; if locked, the webhook handler returns `HTTP 429` with body
    `{ error: "workflow-in-flight", issueKey }` and the poller skips the story
    (as per CREW-60-002). Unit tests cover the lock-set, lock-release, and
    duplicate-trigger paths.
  - **Acceptance (EARS):**
    - WHEN a webhook event arrives for an `issueKey` that already has an
      in-flight workflow, THE SYSTEM SHALL return HTTP 429 with body
      `{ error: "workflow-in-flight", issueKey }`.
    - WHEN a webhook event arrives for an `issueKey` with no in-flight
      workflow, THE SYSTEM SHALL process the event normally.
    - THE SYSTEM SHALL release the in-flight lock for an `issueKey` when its
      workflow completes or fails.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Duplicate webhook for in-flight story is rate limited
      Given a workflow is in flight for issueKey "CREW-63-008"
      When a second webhook event arrives for the same issueKey
      Then HTTP 429 is returned with body { error: "workflow-in-flight", issueKey: "CREW-63-008" }

    Scenario: Webhook for idle story is processed normally
      Given no workflow is in flight for issueKey "CREW-63-009"
      When a webhook event arrives for "CREW-63-009"
      Then the event is processed and HTTP 200 is returned

    Scenario: Lock is released after workflow completion
      Given a workflow for "CREW-63-008" completes
      When a new webhook event arrives for "CREW-63-008"
      Then HTTP 200 is returned and the workflow starts
    ```

---

- [ ] **[CREW-63-009] Cap `getMrDiff()` by file count and byte size**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-63 | **Labels:** review:#25, type:reliability
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/integrations/gitlab.ts`
    `getMrDiff()` truncates the response to `DIFF_FILE_CAP` files (default 50)
    and `DIFF_SIZE_CAP_BYTES` bytes (default 500 000). When the file cap is
    exceeded, the first `DIFF_FILE_CAP` files are retained and a note
    `"[N files omitted — diff truncated at DIFF_FILE_CAP]"` is appended. When
    the byte cap is exceeded, the diff is truncated and a note appended. Both
    caps are configurable via env vars and documented in `.env.example`.
  - **Acceptance (EARS):**
    - WHEN `getMrDiff()` returns more than `DIFF_FILE_CAP` files, THE SYSTEM
      SHALL truncate to the first `DIFF_FILE_CAP` files and append a note
      indicating how many files were omitted.
    - WHEN the total diff size exceeds `DIFF_SIZE_CAP_BYTES`, THE SYSTEM SHALL
      truncate the diff and append a note indicating truncation.
    - WHEN the diff is within both caps, THE SYSTEM SHALL return the full diff
      without modification.
    - WHEN `DIFF_FILE_CAP` is not set, THE SYSTEM SHALL default to `50`.
    - WHEN `DIFF_SIZE_CAP_BYTES` is not set, THE SYSTEM SHALL default to
      `500000`.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Diff with too many files is truncated
      Given a MR with 80 changed files and DIFF_FILE_CAP set to 50
      When getMrDiff() is called
      Then the returned diff contains at most 50 file sections
      And a note indicates that 30 files were omitted

    Scenario: Diff within caps is returned in full
      Given a MR with 10 changed files and a small diff
      When getMrDiff() is called
      Then the full diff is returned without truncation or notes

    Scenario: Diff exceeding byte cap is truncated
      Given a MR diff that exceeds DIFF_SIZE_CAP_BYTES
      When getMrDiff() is called
      Then the returned string is within the byte cap
      And a truncation note is appended
    ```

---

### CREW-64 -- CI/deploy and code quality

**Scope.** Seven low-effort improvements that make the codebase safe to
contribute to and deploy from. These do not affect the runtime delivery flow but
are needed for sustainable development. All stories are independent.

**Key deliverables.** `corepack enable` in Dockerfile; GitHub Actions CI
workflow; explicit lockfile COPY; env var documentation; test mock cleanup;
`extractMrIid()` validation; loop bound comment.

**Dependencies.** None (all stories are independently mergeable).

**Status.** Not started.

---

- [ ] **[CREW-64-001] Fix `delivery-review` Dockerfile to use `corepack enable`**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 1
  - **Epic:** CREW-64 | **Labels:** review:#3, type:infrastructure
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-review/Dockerfile` (if it exists) and any
    Dockerfile in the repo that uses `RUN npm install -g pnpm@9` updated to
    `RUN corepack enable`, so the pnpm version declared in `packageManager` in
    `package.json` is used. `pnpm install --frozen-lockfile` completes without a
    lockfile format mismatch error.
  - **Acceptance (EARS):**
    - WHEN a Docker image is built for any crew, THE SYSTEM SHALL use
      `corepack enable` rather than `npm install -g pnpm@N` to activate pnpm.
    - WHEN `pnpm install --frozen-lockfile` runs inside the built image,
      THE SYSTEM SHALL complete without a lockfile format version mismatch.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Dockerfile uses corepack enable
      Given any Dockerfile in the crews/ directory
      When the RUN instruction for pnpm activation is inspected
      Then it reads "RUN corepack enable" and not "npm install -g pnpm"
    ```

---

- [ ] **[CREW-64-002] Add GitHub Actions CI pipeline**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 3
  - **Epic:** CREW-64 | **Labels:** review:#4, type:infrastructure
  - **Depends on:** —
  - **Deliverable:** `.github/workflows/ci.yml` that triggers on `push` and
    `pull_request` to `main`; runs `pnpm install --frozen-lockfile`, `pnpm
    lint`, `pnpm typecheck`, and `pnpm test`; fails the workflow if any command
    exits non-zero; Node.js version pinned to match the repo's `.nvmrc` or
    `engines` field; pnpm activated via `corepack enable`; `~/.pnpm-store`
    cached keyed on `pnpm-lock.yaml` hash.
  - **Acceptance (EARS):**
    - WHEN a commit is pushed to `main` or a pull request targets `main`,
      THE SYSTEM SHALL trigger the CI workflow.
    - WHEN `pnpm lint`, `pnpm typecheck`, or `pnpm test` exits non-zero,
      THE SYSTEM SHALL fail the CI workflow and report the errors.
    - WHEN all three commands exit zero, THE SYSTEM SHALL mark the workflow as
      passed.
    - THE SYSTEM SHALL cache the pnpm store between runs keyed on
      `pnpm-lock.yaml`.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Clean codebase passes CI
      Given a commit with no lint, type, or test errors
      When the CI workflow runs
      Then all steps exit zero and the workflow is marked as passed

    Scenario: Dependency boundary violation fails CI
      Given a commit where packages/crew imports from crews/delivery-build
      When pnpm lint runs
      Then dependency-cruiser reports a boundary violation and CI fails

    Scenario: pnpm store is cached between runs
      Given a prior CI run has populated the pnpm store cache
      When a subsequent run restores the cache
      Then pnpm install skips redownloading already-cached packages
    ```

---

- [ ] **[CREW-64-003] Fix Dockerfile lockfile `COPY` from glob to explicit**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 1
  - **Epic:** CREW-64 | **Labels:** review:#22, type:infrastructure
  - **Depends on:** —
  - **Deliverable:** Every `Dockerfile` in the repo changed from
    `COPY pnpm-lock.yaml* ./` to `COPY pnpm-lock.yaml ./` (removing the
    optional glob suffix). The intent is explicit and a missing lockfile will
    error loudly at the `COPY` step rather than silently proceeding.
  - **Acceptance (EARS):**
    - WHEN any Dockerfile is evaluated, THE SYSTEM SHALL use
      `COPY pnpm-lock.yaml ./` without an optional glob suffix.
    - WHEN `pnpm-lock.yaml` is absent during a Docker build, THE SYSTEM SHALL
      fail at the `COPY` step rather than silently proceeding.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Lockfile is copied explicitly
      Given all Dockerfiles in the repo
      When the COPY instruction for the lockfile is inspected
      Then each reads "COPY pnpm-lock.yaml ./" without a wildcard suffix
    ```

---

- [ ] **[CREW-64-004] Document `PROJECT_DIR` and `ANTHROPIC_MODEL` env vars**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 1
  - **Epic:** CREW-64 | **Labels:** type:docs
  - **Depends on:** CREW-61-004
  - **Deliverable:** `crews/delivery-build/.env.example` updated to include
    `PROJECT_DIR` (used by `workflow.ts` for memory seeding; defaults to
    `process.cwd()`) and `ANTHROPIC_MODEL` (optional override for the Claude
    model used by both personas; defaults to `claude-opus-4-5`), each with an
    inline description comment. `README.md` environment variable table also
    updated with these two entries. (CREW-61-004 adds the polling and CI vars;
    this story covers only the two gaps from the CREW-50 validation.)
  - **Acceptance (EARS):**
    - WHEN `crews/delivery-build/.env.example` is read, THE SYSTEM SHALL list
      `PROJECT_DIR` and `ANTHROPIC_MODEL` with description comments.
    - WHEN `crews/delivery-build/README.md` is read, THE SYSTEM SHALL document
      `PROJECT_DIR` and `ANTHROPIC_MODEL` in the environment variable table.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: .env.example includes PROJECT_DIR and ANTHROPIC_MODEL
      Given crews/delivery-build/.env.example is read
      When it is searched for PROJECT_DIR and ANTHROPIC_MODEL
      Then both are present with non-empty description comments

    Scenario: README table includes both vars
      Given crews/delivery-build/README.md is read
      When the environment variables table is inspected
      Then PROJECT_DIR and ANTHROPIC_MODEL appear as rows with descriptions
    ```

---

- [ ] **[CREW-64-005] Remove spurious `db` property from test mock helpers**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 1
  - **Epic:** CREW-64 | **Labels:** review:#13, type:test
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/tests/workflow.test.ts` and
    `crews/delivery-build/tests/handlers.jira.test.ts` `makeState()` helpers
    have `db: {} as never` removed. `pnpm typecheck` passes with no
    excess-property errors on the state mock literal.
  - **Acceptance (EARS):**
    - WHEN `makeState()` is called in test helpers, THE SYSTEM SHALL return an
      object whose properties are a subset of the `StateStore` interface with no
      excess properties.
    - WHEN `pnpm typecheck` runs, THE SYSTEM SHALL report zero TypeScript errors
      related to `db` in test mock objects.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: makeState() has no excess db property
      Given workflow.test.ts and handlers.jira.test.ts
      When the makeState() objects are inspected
      Then neither contains a "db" property

    Scenario: pnpm typecheck passes after removal
      Given db: {} as never is removed from both test files
      When pnpm typecheck runs
      Then no TypeScript errors related to the mock objects are reported
    ```

---

- [ ] **[CREW-64-006] Fix `extractMrIid()` URL validation**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 2
  - **Epic:** CREW-64 | **Labels:** review:#18, type:correctness
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/integrations/gitlab.ts`
    `extractMrIid()` validates that the extracted project path (from the URL)
    matches `GITLAB_PROJECT_ID` before returning the IID. If there is a
    mismatch, the function throws a typed `GitLabUrlError` rather than silently
    returning a wrong IID. Unit tests cover the valid path and the mismatch
    path.
  - **Acceptance (EARS):**
    - WHEN `extractMrIid()` is called with a URL whose project path does not
      match `GITLAB_PROJECT_ID`, THE SYSTEM SHALL throw a typed error rather
      than returning an IID from the wrong project.
    - WHEN `extractMrIid()` is called with a valid URL matching
      `GITLAB_PROJECT_ID`, THE SYSTEM SHALL return the correct numeric IID.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: URL from correct project returns IID
      Given GITLAB_PROJECT_ID is "daddia/crew"
      And a webUrl of "https://gitlab.com/daddia/crew/-/merge_requests/42"
      When extractMrIid(webUrl) is called
      Then 42 is returned

    Scenario: URL from wrong project throws
      Given GITLAB_PROJECT_ID is "daddia/crew"
      And a webUrl of "https://gitlab.com/other/repo/-/merge_requests/42"
      When extractMrIid(webUrl) is called
      Then a typed GitLabUrlError is thrown indicating project path mismatch
    ```

---

- [ ] **[CREW-64-007] Add loop-bound asymmetry comment to `workflow.ts`**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 1
  - **Epic:** CREW-64 | **Labels:** review:#23, type:docs
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/workflow.ts` peer-review loop
    has a comment explaining the asymmetry: with `REFACTOR_LOOP_CAP=N` the loop
    runs `N+1` senior-engineer peer-review calls (iterations 0 through N) but
    only `N` address-feedback calls (the `if (iteration >= REFACTOR_LOOP_CAP)
    break` prevents the Nth address-feedback). `AGENTS.md` updated to reflect
    this semantic precisely.
  - **Acceptance (EARS):**
    - WHEN `workflow.ts` is read, THE SYSTEM SHALL contain a comment at the
      peer-review loop bound explaining the `N+1` senior-engineer call count
      versus the `N` address-feedback call count.
    - WHEN `AGENTS.md` documents the loop cap, THE SYSTEM SHALL accurately
      state the asymmetry.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Loop bound comment explains asymmetry
      Given workflow.ts at the peer-review loop
      When the code comment near the loop bound is read
      Then it explains that REFACTOR_LOOP_CAP=N allows N+1 senior-engineer calls
      And that only N address-feedback calls are made
    ```

---

## 5. Dependency graph

```text
CREW-60 (Jira polling trigger)
  +-- CREW-60-001 (searchIssues + setInterval poller)
        +-- CREW-60-002 (dedup guard — state + in-flight lock check)
              +-- CREW-62-002 (clarification resume via poller tick)

CREW-61 (Workflow sequence alignment)
  +-- CREW-61-001 (reorder: MR after peer review)
  +-- CREW-61-002 (context seeding: getIssue → context.ticket)
        +-- CREW-62-001 (clarification assessment step)
  +-- CREW-61-003 (CI pipeline check — after CREW-61-001)
        +-- CREW-61-004 (In QA handoff — after CREW-61-003)
  +-- CREW-61-005 (sessionId → startStep)
        +-- CREW-63-003 (crash recovery — needs session_id in steps table)

CREW-62 (Clarification HITL)
  +-- CREW-62-001 (after CREW-61-002)
  +-- CREW-62-002 (after CREW-62-001 + CREW-60-001)

CREW-63 (Correctness/reliability — all independent)
  +-- CREW-63-001 (env validation)
        +-- CREW-63-002 (auth header inside jiraFetch — best after 001)
  +-- CREW-63-003 (crash recovery — needs CREW-61-005)
  +-- CREW-63-004 (MCP pin)
  +-- CREW-63-005 (SQLite consolidation)
  +-- CREW-63-006 (finishStep fix)
  +-- CREW-63-007 (createMr idempotency)
  +-- CREW-63-008 (in-flight lock — consumed by CREW-60-002)
  +-- CREW-63-009 (getMrDiff cap)

CREW-64 (CI/deploy/quality — all independent)
```

## 6. Critical path

```text
CREW-60-001 (poller)
  → CREW-60-002 (dedup)
  → CREW-61-001 (reorder workflow)
  → CREW-61-002 (context seed)
  → CREW-61-003 (CI check)
  → CREW-61-004 (In QA handoff)
  → system is end-to-end testable

CREW-63-008 (in-flight lock)  } unblocked; needed before e2e run
CREW-63-006 (finishStep fix)  }
CREW-63-007 (createMr idempotency) }
```

## 7. Minimum viable slice

The smallest coherent path that produces an end-to-end testable delivery-build
run:

1. **CREW-60-001** — poller discovers and triggers stories
2. **CREW-60-002** — dedup guard prevents double-runs
3. **CREW-61-001** — MR opens after peer review (correct order)
4. **CREW-61-002** — engineer receives full ticket context
5. **CREW-61-003** — CI is checked before handoff
6. **CREW-61-004** — ticket lands in `In QA`
7. **CREW-63-006** — `finishStep()` updates the right row (correctness)
8. **CREW-63-007** — no duplicate MRs on retry (correctness)
9. **CREW-63-008** — in-flight lock prevents concurrent runs

With this slice in place a story can be picked up from Jira, implemented,
reviewed, MR'd, CI-checked, and handed to QA without data corruption or
duplicate side effects. Clarification (CREW-62), crash recovery (CREW-63-003),
and CI/deploy hardening (CREW-64) follow.

## 8. Assumptions

| ID | Assumption | Impact if wrong |
| --- | --- | --- |
| A1 | Jira board uses status names `"To Do"`, `"In Progress"`, `"Clarification Needed"`, `"In QA"`, `"Needs Human Review"` exactly as written | `transitionIssue()` silently no-ops if the transition name doesn't match; validate status names against the board before first run |
| A2 | `JIRA_ASSIGNEE_ACCOUNT_ID` is a Jira account ID (not a display name) suitable for use in JQL `assignee = "..."` queries | Incorrect format causes the poller's JQL to return no results; verify via Jira API before configuring |
| A3 | The `@anthropic-ai/claude-agent-sdk` `getPipelineStatus` approach (MCP GitLab tools) returns pipeline status quickly enough for the CI polling loop to be practical | If the SDK/MCP round-trip adds >30 s latency, `CI_POLL_INTERVAL_MS` may need tuning; spike during CREW-61-003 |
| A4 | The Railway persistent volume at `DB_PATH` survives restarts, making crash recovery (CREW-63-003) meaningful | Without persistence the SQLite state is ephemeral and crash recovery is moot |

## 9. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Jira status names on the actual board differ from the names used in `transitionIssue()` calls | Medium | High | Audit board config before first run; add a startup check that logs available transitions for the first polled issue |
| R2 | CI pipeline takes >10 min per run, causing the CI poll loop to block the workflow for extended periods | Medium | Medium | Make `CI_POLL_INTERVAL_MS` configurable; consider a max-wait cap separate from `CI_RETRY_CAP` |
| R3 | `getPipelineStatus()` via GitLab MCP returns stale pipeline data due to caching | Low | Medium | Verify MCP response freshness in a smoke test; fall back to direct REST call if needed |
| R4 | `finishStep()` race condition: two concurrent workflow callbacks both update the same unfinished step row | Low | Medium | CREW-63-006 adds the `step` column filter; CREW-63-008 in-flight lock prevents concurrent runs for the same issueKey |

## 10. Definition of Done

A story in this backlog is done when:

- [ ] All EARS acceptance statements hold and every Gherkin scenario passes.
- [ ] `pnpm typecheck` passes with zero new errors.
- [ ] `pnpm lint` passes with no new dependency-cruiser violations.
- [ ] `pnpm test` passes with no new failures; new behaviour has >= 80% branch
      coverage.
- [ ] New env vars documented in `.env.example` and `README.md`.
- [ ] `AGENTS.md` updated if the repo's public surface or conventions changed.
- [ ] PR merged to `main`.

## 11. Handoff

When CREW-60 and CREW-61 close, delivery-build can be run end-to-end against a
real Jira board. When CREW-62 closes, the crew no longer stalls on ambiguous
tickets. When CREW-63 closes, the system is safe to run unattended. When CREW-64
closes, every PR is gated by CI and the codebase is clean.

After the delivery-build slice is validated end-to-end:

- `delivery-review` fast-follows with `tech-lead` persona (final code review,
  MR merge, Jira close)
- `delivery-qa` crew follows with `qa-engineer` persona
- Remediation re-entry path (delivery-build v2) opens once delivery-qa exists

---

## 12. Future backlog

### F-01 -- Shared team memory across personas

Each persona currently writes to its own `memory: 'project'` directory. After
three or more stories complete end-to-end, add a shared read path so the
engineer can see patterns the senior engineer has flagged without direct
inter-persona communication.

**Priority.** Post-operational. Depends on CREW-61 being stable.

---

### F-02 -- Remediation re-entry path

Delivery-build v2: the poller picks up `In Remediation` + `qa-remediation`
label tickets, reads QA defect notes, fixes on branch, re-runs CI, removes the
label, and re-transitions to `In QA`. Requires delivery-qa crew to exist.

**Priority.** After delivery-qa crew ships.

---

### F-03 -- `delivery-review` crew

`tech-lead` persona: architecture gate, PM HITL pause, MR approval + merge,
Jira close. Triggered by polling `In QA` tickets (or `ready-for-review` signal
from delivery-qa).

**Priority.** Fast-follow after delivery-build e2e is validated.
