---
type: Backlog
scope: product
product: crew-runtime
version: '3.0'
owner: daddia
status: Active
last_updated: 2026-05-06
related:
  - docs/crew-flows/delivery-build.md
  - docs/product/product.md
  - AGENTS.md
---

# Backlog -- Delivery-Build Slice (v3)

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

**Where we are.** The polling trigger, workflow sequence (`context-seed →
assess-clarification → implement → peer review → open-mr → ci-check → in-qa`),
clarification HITL step, env validation, crash recovery, single-SQLite
consolidation, `finishStep()` correctness fix, GitHub Actions CI, and Docker
hygiene work have all landed. See section 12 (Completed work) for the full
provenance trail across CREW-60, CREW-61, CREW-62, CREW-63, and CREW-64.

**What's left to actually ship.** Two epics. CREW-66 closes the remaining
functional and correctness gaps that prevent the workflow from running
unattended on real Jira + GitLab — most importantly, the agent personas don't
yet emit the structured artefacts the workflow consumes (`branchName`,
`title`, `questionsRequired`, `questions`, `comments`). CREW-67 adds the
operational handles needed to deploy, monitor, and validate the slice end to
end against a real board.

**Critical path.** CREW-66-001 and CREW-66-002 are the blocker: until the
agents return real artefacts, every workflow run halts at the first
`assessResult.artefacts["questionsRequired"] === true` check or returns
without `branchName` and falls through to escalation. Everything else in
CREW-66 is independent and parallelisable. CREW-67 starts once CREW-66 is in
place because the end-to-end smoke test (CREW-67-005) is the gate that
validates the slice is shippable.

**Deferred.** `tech-lead` persona (delivery-review crew), `code-quality`
persona (delivery-qa crew), QA remediation re-entry, OTel tracing, Turbo
remote cache, shared cross-persona memory. See section 13 (Future backlog).

---

## 2. Conventions

| Convention | Value |
| --- | --- |
| Epic ID format | `CREW-{nn}` (continuing from 65) |
| Story ID format | `CREW-{nn}-{nnn}` |
| Status values | Not started, In progress, Done, Blocked |
| Priority levels | P0 (blocks end-to-end run), P1 (reliability), P2 (quality) |
| Estimation | Fibonacci story points (1, 2, 3, 5, 8) |
| Acceptance format | EARS + Gherkin |

---

## 3. Epic breakdown

| Epic | Title | Phase | Priority | Deps | Points | WP path | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CREW-66 | Functional and hardening completion | Now | P0 | — | 16 | `crews/delivery-build` | Not started |
| CREW-67 | End-to-end validation and operations | Now | P0 | CREW-66 | 12 | `crews/delivery-build` | Not started |
| **Total** | | | | | **28** | | |

---

## 4. Epic detail

---

### CREW-66 -- Functional and hardening completion

**Scope.** Close the remaining gaps that prevent `delivery-build` from
running end-to-end against a real Jira board and GitLab project. Two are
critical correctness fixes (agents must emit structured artefacts the
workflow already consumes); the rest are reliability and idempotency
guarantees the system needs before it's safe to leave unattended.

**Key deliverables.** Engineer and senior-engineer parse the structured
`AgentResult.artefacts` JSON from the SDK result message; MCP server versions
are pinned in `mcp.json`; `createMr()` checks for an existing open MR before
opening a new one; webhook handlers return `HTTP 429` when an `issueKey` is
already in flight; `getMrDiff()` truncates oversized diffs by file count and
byte size; `extractMrIid()` validates the URL's project path against
`GITLAB_PROJECT_ID`.

**Dependencies.** None. CREW-66-001 and CREW-66-002 are critical-path; the
other five stories are independently mergeable.

**Status.** Not started.

**Work-package path.** `crews/delivery-build` (no separate WP design doc;
each story is small and self-contained).

---

- [ ] **[CREW-66-001] Engineer extracts structured artefacts from SDK result**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 3
  - **Epic:** CREW-66 | **Labels:** type:correctness, e2e-blocker
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/src/agents/engineer/agent.ts` parses
    the structured JSON output specified by each skill's "Output contract"
    section out of `resultMsg.result` and merges it into the returned
    `AgentResult.artefacts`. The engineer recognises the three task shapes:
    `assess-clarification` (`questionsRequired: boolean`, optional
    `questions: string`, optional `blocker: string`), `implement-story`
    (`branchName: string`, `title: string`, `description: string`,
    `filesChanged`, `commits`), and `address-feedback` (same shape as
    `implement-story` plus a `resolved: string[]`). On parse failure the
    function returns `success: false` with `summary` quoting the parse error
    and the first 500 characters of `resultMsg.result`. `sessionId` continues
    to be merged in alongside the parsed artefacts. The skill prompts already
    specify the JSON shape; this story does not modify them.
  - **Acceptance (EARS):**
    - WHEN `engineer.run()` returns from a successful SDK invocation,
      THE SYSTEM SHALL parse the JSON object found in `resultMsg.result` and
      merge it into `AgentResult.artefacts` alongside `sessionId`.
    - WHEN the parsed artefact is from `task: "assess-clarification"`,
      THE SYSTEM SHALL include `questionsRequired` as a boolean in
      `AgentResult.artefacts`.
    - WHEN the parsed artefact is from `task: "implement-story"`,
      THE SYSTEM SHALL include `branchName` and `title` as strings in
      `AgentResult.artefacts` whenever the model populated them.
    - WHEN the SDK result is not a parsable JSON artefact envelope, THE
      SYSTEM SHALL return `success: false` with a summary that names the
      parse failure and includes a truncated excerpt of the raw result.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Implementation result yields branchName and title
      Given engineer.run() invoked with task "implement-story"
      And resultMsg.result contains a JSON object with branchName "feature/CREW-1-foo" and title "Add foo"
      When the engineer parses the result
      Then AgentResult.artefacts.branchName equals "feature/CREW-1-foo"
      And AgentResult.artefacts.title equals "Add foo"
      And AgentResult.artefacts.sessionId is preserved

    Scenario: Clarification skill returns questionsRequired: true
      Given engineer.run() invoked with task "assess-clarification"
      And resultMsg.result contains { questionsRequired: true, questions: "..." }
      When the engineer parses the result
      Then AgentResult.artefacts.questionsRequired is the boolean true
      And AgentResult.artefacts.questions equals the model's question text

    Scenario: Unparsable result downgrades to success: false
      Given engineer.run() returns a result message whose text is not JSON
      When the engineer parses the result
      Then AgentResult.success is false
      And AgentResult.summary names the parse failure
      And the summary includes the first 500 characters of the raw result
    ```

---

- [ ] **[CREW-66-002] Senior-engineer extracts structured artefacts from SDK result**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 2
  - **Epic:** CREW-66 | **Labels:** type:correctness, e2e-blocker
  - **Depends on:** —
  - **Deliverable:**
    `crews/delivery-build/src/agents/senior-engineer/agent.ts` parses the
    JSON object specified by `peer-code-review/SKILL.md` out of
    `resultMsg.result` and merges it into `AgentResult.artefacts`. The
    expected shape is `{ verdict: "approved" | "changes-requested",
    comments: Array<{ path: string; line: string | number; category:
    "blocker" | "warning" | "suggestion"; observed: string; remediation:
    string }> }`. The workflow already consumes
    `reviewResult.artefacts["comments"]` as `string[]`; the agent flattens
    each finding into `"<path>:<line> [<category>] <observed> — <remediation>"`
    so that consumers continue to work without a workflow change. Parse
    failures fall back to `success: false` as in CREW-66-001.
  - **Acceptance (EARS):**
    - WHEN `seniorEngineer.run()` returns from a successful SDK invocation,
      THE SYSTEM SHALL parse the JSON object in `resultMsg.result` and merge
      its fields into `AgentResult.artefacts`.
    - WHEN the parsed verdict is `"approved"`, THE SYSTEM SHALL set
      `AgentResult.success` to `true` and `artefacts.comments` to an empty
      string array.
    - WHEN the parsed verdict is `"changes-requested"`, THE SYSTEM SHALL set
      `AgentResult.success` to `false` and populate `artefacts.comments` as
      a flat string array of finding lines.
    - WHEN the SDK result is not a parsable JSON artefact envelope,
      THE SYSTEM SHALL return `success: false` with a summary naming the
      parse failure.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Approval result returns success with empty comments
      Given seniorEngineer.run() returns a result whose JSON is { verdict: "approved", comments: [] }
      When the senior-engineer parses the result
      Then AgentResult.success is true
      And AgentResult.artefacts.comments equals []

    Scenario: Changes requested with structured findings
      Given a JSON result with verdict "changes-requested" and two findings
      When the senior-engineer parses the result
      Then AgentResult.success is false
      And AgentResult.artefacts.comments is an array of two strings
      And each string contains the path, line, category, observed, and remediation

    Scenario: Unparsable result downgrades to success: false
      Given seniorEngineer.run() returns a result whose text is not JSON
      When the senior-engineer parses the result
      Then AgentResult.success is false
      And AgentResult.summary names the parse failure
    ```

---

- [ ] **[CREW-66-003] Pin MCP server versions in `mcp.json`**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-66 | **Labels:** review:#9, type:reliability
  - **Depends on:** —
  - **Deliverable:** `crews/delivery-build/mcp.json` updated so each MCP
    server package is referenced with an explicit version specifier
    (e.g. `@anthropic-ai/mcp-server-gitlab@1.2.3`). `npx -y` no longer
    downloads the latest version on every agent invocation, eliminating
    version drift mid-flight and trimming agent cold-start time. A test under
    `crews/delivery-build/tests/mcp-config.test.ts` parses `mcp.json`,
    iterates the configured servers, and asserts every package args entry
    contains an `@x.y.z` segment.
  - **Acceptance (EARS):**
    - WHEN `mcp.json` is read, THE SYSTEM SHALL reference each MCP server
      package with an explicit version specifier of the form
      `<package>@<semver>`.
    - WHEN a new version of either package is published, THE SYSTEM SHALL
      NOT automatically upgrade unless the version specifier in `mcp.json`
      is explicitly updated.
    - WHEN the new test suite runs, THE SYSTEM SHALL fail if any
      `args` entry references an MCP package without a version specifier.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: MCP server args include pinned version
      Given crews/delivery-build/mcp.json
      When the args array for mcp-server-gitlab is inspected
      Then the package name includes a version specifier (e.g. @1.2.3)

    Scenario: Test suite catches an unpinned package
      Given mcp.json is edited to remove the version pin from atlassian
      When the mcp-config test runs
      Then it fails with a message naming the unpinned package
    ```

---

- [ ] **[CREW-66-004] Add idempotency guard to `createMr()`**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-66 | **Labels:** review:#10, type:correctness
  - **Depends on:** —
  - **Deliverable:**
    `crews/delivery-build/src/integrations/gitlab.ts` `createMr()` calls
    `GET /projects/{id}/merge_requests?source_branch={branchName}&state=opened`
    before `POST /merge_requests`. If an open MR already exists for the
    branch, the function returns the existing MR's `web_url` without issuing
    a duplicate POST. A `GET` failure is propagated to the caller rather
    than swallowed. Unit tests cover the existing-MR, no-existing-MR, and
    `GET`-failure paths.
  - **Acceptance (EARS):**
    - WHEN `createMr()` is called and an open MR already exists for
      `branchName`, THE SYSTEM SHALL return the existing MR's `web_url`
      without issuing a `POST /merge_requests` request.
    - WHEN `createMr()` is called and no open MR exists for `branchName`,
      THE SYSTEM SHALL proceed with `POST /merge_requests` and return the
      new MR's `web_url`.
    - WHEN the `GET /merge_requests` lookup fails, THE SYSTEM SHALL
      propagate the error rather than silently creating a duplicate MR.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Existing MR is returned without duplicate POST
      Given an open MR exists for branch "feature/CREW-66-004"
      When createMr() is called with that branchName
      Then GET /merge_requests?source_branch=feature/CREW-66-004 is called
      And no POST /merge_requests request is issued
      And the existing MR's web_url is returned

    Scenario: No existing MR -- new MR is created
      Given no open MR exists for branch "feature/CREW-66-004"
      When createMr() is called
      Then the GET lookup returns an empty list
      And POST /merge_requests is issued
      And the new MR's web_url is returned

    Scenario: GET lookup failure propagates as error
      Given the GitLab API returns 500 for the GET lookup
      When createMr() is called
      Then a GitLabApiError is thrown
      And no POST /merge_requests is issued
    ```

---

- [ ] **[CREW-66-005] Webhook handlers return 429 when issueKey is in flight**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-66 | **Labels:** review:#20, type:reliability
  - **Depends on:** —
  - **Deliverable:** The poller already maintains an in-process
    `inFlight: Set<string>` in `crews/delivery-build/src/poller.ts`. Move
    that lock into a shared module (`crews/delivery-build/src/in-flight.ts`)
    that exports `acquire(issueKey)`, `release(issueKey)`, and
    `has(issueKey)`. Update `poller.ts` to use the shared module, and update
    `handlers/jira.ts` and `handlers/gitlab.ts` to check `has(issueKey)`
    before dispatching the workflow. When the lock is held, the handler
    returns `HTTP 429` with body
    `{ error: "workflow-in-flight", issueKey }`. Each handler that does
    dispatch the workflow calls `acquire()` before the `setImmediate`
    callback and `release()` in the workflow's `finally` block (lift the
    `acquire/release` pattern out of `pollTick` into a shared
    `runStoryWithLock` wrapper). Unit tests cover the lock-held, lock-free,
    and workflow-completion-releases-lock paths for both webhook handlers.
  - **Acceptance (EARS):**
    - WHEN a webhook event arrives for an `issueKey` that already has an
      in-flight workflow, THE SYSTEM SHALL return HTTP 429 with body
      `{ error: "workflow-in-flight", issueKey }`.
    - WHEN a webhook event arrives for an `issueKey` with no in-flight
      workflow, THE SYSTEM SHALL acquire the lock and dispatch the workflow.
    - WHEN a workflow completes or throws, THE SYSTEM SHALL release the
      in-flight lock for its `issueKey`.
    - THE SYSTEM SHALL share a single `inFlight` set between the poller and
      the webhook handlers within a single process.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Duplicate Jira webhook for in-flight story is rate limited
      Given a workflow is in flight for issueKey "CREW-66-005"
      When a Jira "Ready for Dev" event arrives for the same issueKey
      Then HTTP 429 is returned with body { error: "workflow-in-flight", issueKey: "CREW-66-005" }

    Scenario: GitLab note webhook respects the same lock
      Given a workflow is in flight for issueKey "CREW-66-006"
      When a GitLab note webhook arrives for the same issueKey
      Then HTTP 429 is returned with body { error: "workflow-in-flight", issueKey: "CREW-66-006" }

    Scenario: Lock is released after workflow completion
      Given a workflow for "CREW-66-007" completes successfully
      When a new webhook event arrives for "CREW-66-007"
      Then HTTP 200 is returned and the workflow starts
    ```

---

- [ ] **[CREW-66-006] Cap `getMrDiff()` by file count and byte size**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-66 | **Labels:** review:#25, type:reliability
  - **Depends on:** —
  - **Deliverable:**
    `crews/delivery-build/src/integrations/gitlab.ts` `getMrDiff()` truncates
    its return value to `DIFF_FILE_CAP` files (default 50) and
    `DIFF_SIZE_CAP_BYTES` bytes (default 500 000). When the file cap is
    exceeded, the first `DIFF_FILE_CAP` files are kept and a trailing note
    `"[N files omitted — diff truncated at DIFF_FILE_CAP]"` is appended.
    When the byte cap is exceeded, the diff is truncated to the cap and a
    `"[diff truncated at DIFF_SIZE_CAP_BYTES bytes]"` note is appended.
    Both caps are added to the `behaviour` block of the `Config` schema in
    `config.ts`, mapped to the env vars `DIFF_FILE_CAP` and
    `DIFF_SIZE_CAP_BYTES`, and documented in `.env.example` and `README.md`.
  - **Acceptance (EARS):**
    - WHEN `getMrDiff()` would return more than `DIFF_FILE_CAP` files,
      THE SYSTEM SHALL truncate to the first `DIFF_FILE_CAP` files and
      append a note indicating how many files were omitted.
    - WHEN the assembled diff exceeds `DIFF_SIZE_CAP_BYTES`, THE SYSTEM
      SHALL truncate the string to the cap and append a truncation note.
    - WHEN the diff is within both caps, THE SYSTEM SHALL return the full
      diff without modification.
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
      Then the returned string length is at most DIFF_SIZE_CAP_BYTES plus the note
      And a truncation note is appended
    ```

---

- [ ] **[CREW-66-007] Validate `extractMrIid()` URL project path**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 1
  - **Epic:** CREW-66 | **Labels:** review:#18, type:correctness
  - **Depends on:** —
  - **Deliverable:**
    `crews/delivery-build/src/integrations/gitlab.ts` `extractMrIid()` parses
    the project path segment from the URL (everything between the host and
    `/-/merge_requests/`) and asserts it matches the URL-decoded
    `GITLAB_PROJECT_ID` (or its numeric form). On mismatch the function
    throws a typed `GitLabUrlError` rather than silently returning an IID
    from the wrong project. A new `GitLabUrlError extends Error` is exported
    from `gitlab.ts`. Unit tests cover the matching path, the mismatch path,
    and the missing-`/merge_requests/` path.
  - **Acceptance (EARS):**
    - WHEN `extractMrIid()` is called with a URL whose project path matches
      `GITLAB_PROJECT_ID`, THE SYSTEM SHALL return the numeric IID as a
      string.
    - WHEN `extractMrIid()` is called with a URL whose project path does
      not match `GITLAB_PROJECT_ID`, THE SYSTEM SHALL throw
      `GitLabUrlError` with a message naming both the expected and received
      project paths.
    - WHEN `extractMrIid()` is called with a URL that contains no
      `/merge_requests/{n}` segment, THE SYSTEM SHALL throw
      `GitLabUrlError`.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: URL from correct project returns IID
      Given GITLAB_PROJECT_ID is "daddia/crew"
      And a webUrl of "https://gitlab.com/daddia/crew/-/merge_requests/42"
      When extractMrIid(webUrl) is called
      Then "42" is returned

    Scenario: URL from wrong project throws GitLabUrlError
      Given GITLAB_PROJECT_ID is "daddia/crew"
      And a webUrl of "https://gitlab.com/other/repo/-/merge_requests/42"
      When extractMrIid(webUrl) is called
      Then GitLabUrlError is thrown
      And the error message names "daddia/crew" and "other/repo"

    Scenario: URL without merge_requests segment throws
      Given a webUrl of "https://gitlab.com/daddia/crew"
      When extractMrIid(webUrl) is called
      Then GitLabUrlError is thrown
    ```

---

### CREW-67 -- End-to-end validation and operations

**Scope.** Add the operational handles needed to deploy, monitor, and
validate the slice end-to-end. The epic ends with a real story executed on
a real Jira board against a real GitLab project — the gate that proves the
slice is shippable. This epic intentionally stays minimal: the goal is
"shippable end-to-end", not "fully observable at scale".

**Key deliverables.** A pre-flight diagnostics command that verifies
configuration against the real Jira board and GitLab project before the
server binds; a per-story cost summary log emitted on workflow completion;
the `/healthz` endpoint extended with poller and in-flight state; an
operations runbook covering deploy, monitor, and recover; the first end-to-
end story run captured as a smoke test report.

**Dependencies.** CREW-66 (the workflow must be functional and idempotent
before it is exercised against a real board). All five stories within this
epic are independent except CREW-67-005, which gates on the rest.

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
    prints the failing check's `detail`. The `boot()` function in
    `index.ts` does not call `runDiagnostics` automatically — it is an
    operator-driven command.
  - **Acceptance (EARS):**
    - WHEN `pnpm diagnose` is run with a complete `.env`, THE SYSTEM SHALL
      execute every check and print a summary with one line per check.
    - WHEN any check fails, THE SYSTEM SHALL exit with code 1 and the final
      summary line SHALL state which checks failed.
    - WHEN every check passes, THE SYSTEM SHALL exit with code 0.
    - WHEN one of the four expected Jira transitions is not available on
      the probed issue, THE SYSTEM SHALL fail the transitions check and
      list the missing transition names.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Diagnostics pass on a properly configured environment
      Given a .env with valid Jira and GitLab credentials and a board configured with the four expected statuses
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
    - WHEN `runStory()` reaches the `In QA` handoff, THE SYSTEM SHALL emit
      a single `workflow.complete` info log with `success: true` and a
      `totalCostUsd` summed across all step rows for the issueKey.
    - WHEN `runStory()` escalates to `Needs human review`, THE SYSTEM SHALL
      emit a `workflow.complete` info log with `success: false` and the
      same cost summary.
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
  - **Depends on:** CREW-66-005
  - **Deliverable:** `crews/delivery-build/src/index.ts` `/healthz`
    endpoint returns
    `{ ok: true, schemaVersion, poller: { lastTickAt, lastTickStatus,
    inFlightCount, inFlight: string[] }, db: { ok, path } }`. The poller
    publishes its `lastTickAt` and `lastTickStatus` ("ok" | "error") into a
    small in-memory state object exported alongside the `inFlight` set
    (CREW-66-005). The DB check runs `SELECT 1` against the SQLite
    connection and reports `ok: false` if the query throws. The HTTP
    response remains `200 OK` regardless — operators read the structured
    body — to avoid Railway's healthcheck bouncing the container on transient
    DB hiccups. A new `tests/healthz.test.ts` covers the happy path, a
    failed DB check, and a stale `lastTickAt`.
  - **Acceptance (EARS):**
    - WHEN `/healthz` is requested, THE SYSTEM SHALL return HTTP 200 with a
      JSON body containing `ok`, `schemaVersion`, `poller`, and `db`.
    - WHEN the poller has executed at least one tick, THE SYSTEM SHALL
      include `lastTickAt` (ms epoch) and `lastTickStatus` in the response.
    - WHEN one or more workflows are in flight, THE SYSTEM SHALL include
      `inFlightCount` and `inFlight` (issueKey array) reflecting the shared
      in-flight set from CREW-66-005.
    - WHEN the SQLite connection is healthy, THE SYSTEM SHALL set
      `db.ok` to `true` and include the `dbPath` in the response.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: /healthz includes poller and db state
      Given the poller has executed two ticks and one workflow is in flight for "CREW-67-003"
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
    the service requires (cross-link `crews/delivery-build/README.md`
    rather than restating); (3) post-deploy smoke test (verify `/healthz`,
    verify a poll tick log appears within `POLL_INTERVAL_MS`); (4)
    monitoring guide listing the structured log events to alert on
    (`workflow.escalate`, `poller.search-error`, `recovery.session-failed`,
    `workflow.complete` with `success: false`); (5) recovery procedures
    for the three failure modes the system already handles (in-flight on
    boot, clarification timeout, refactor cap reached) plus the SQLite
    volume-loss path; (6) cost controls — how to set `REFACTOR_LOOP_CAP`,
    `CI_RETRY_CAP`, and `CLARIFICATION_TIMEOUT_HOURS` against the cost
    budget. The runbook references `docs/crew-flows/delivery-build.md` for
    the canonical sequence.
  - **Acceptance (EARS):**
    - WHEN `docs/runbook/delivery-build.md` is read, THE SYSTEM SHALL
      contain numbered sections for pre-deploy, deploy, post-deploy smoke
      test, monitoring, recovery, and cost controls.
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
  - **Depends on:** CREW-66-001, CREW-66-002, CREW-66-003, CREW-66-004,
    CREW-66-005, CREW-66-006, CREW-67-001, CREW-67-002
  - **Deliverable:** A real Jira story is taken end-to-end through the
    `delivery-build` slice on a sandboxed Jira project and a sandboxed
    GitLab project. The story is small and well-specified (single-file
    change, AC stated as EARS). Capture: the Jira issue link; the
    `pnpm diagnose` output; the run's structured logs from the Railway
    deploy (poll tick, context-seed, assess-clarification, implement,
    peer-code-review pass, open-mr, ci-check pass, in-qa transition);
    the resulting MR URL; the `workflow.complete` cost summary; the time
    from polled-pickup to In QA. Save the report under
    `docs/reviews/2026-Q2-delivery-build-e2e.md`. The report explicitly
    notes any deviations from the documented sequence in
    `docs/crew-flows/delivery-build.md`. If the run escalates, the report
    documents the cause and at least one follow-up story is filed against
    a new epic (or against CREW-66/66 if the cause maps to an existing
    story scope).
  - **Acceptance (EARS):**
    - WHEN the e2e run completes, THE SYSTEM SHALL transition the test
      issue to `In QA` and the MR's pipeline SHALL be green.
    - WHEN the run completes, THE SYSTEM SHALL emit the `workflow.complete`
      info log captured in `docs/reviews/2026-Q2-delivery-build-e2e.md`.
    - WHEN the e2e report is filed, THE SYSTEM SHALL include the issue
      link, MR URL, total cost in USD, total duration, and a copy of the
      structured log line for each step transition.
    - WHEN the run does not reach `In QA`, THE SYSTEM SHALL escalate to
      `Needs human review` (already covered in CREW-61-004) and the report
      SHALL document the cause and at least one follow-up story.
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
CREW-66 (Functional and hardening completion)
  +-- CREW-66-001 (engineer artefact extraction) [e2e blocker]
  +-- CREW-66-002 (senior-engineer artefact extraction) [e2e blocker]
  +-- CREW-66-003 (pin MCP versions)
  +-- CREW-66-004 (createMr idempotency)
  +-- CREW-66-005 (webhook in-flight 429)
        +-- CREW-67-003 (healthz exposes shared in-flight)
  +-- CREW-66-006 (getMrDiff size cap)
  +-- CREW-66-007 (extractMrIid project validation)

CREW-67 (End-to-end validation and operations)
  +-- CREW-67-001 (pre-flight diagnostics)
  +-- CREW-67-002 (cost summary log)
  +-- CREW-67-003 (healthz state) -- after CREW-66-005
  +-- CREW-67-004 (runbook) -- after 66-001, 66-002, 66-003
  +-- CREW-67-005 (e2e run) -- after CREW-66 + 66-001 + 66-002
```

## 6. Critical path

```text
CREW-66-001 (engineer artefact extraction)
  → CREW-66-002 (senior-engineer artefact extraction)
  → CREW-66-004 (createMr idempotency)
  → CREW-66-005 (webhook in-flight 429)
  → CREW-67-001 (pre-flight diagnostics)
  → CREW-67-002 (cost summary log)
  → CREW-67-005 (first e2e run on real Jira + GitLab)
```

CREW-66-003, CREW-66-006, CREW-66-007, CREW-67-003, and CREW-67-004 are
parallelisable around the critical path.

## 7. Minimum viable slice

The smallest set of stories that produces a runnable, observable end-to-end
delivery-build slice — i.e. one that we can hand to a real story and watch
land in `In QA`:

1. **CREW-66-001** — engineer extracts artefacts so the workflow's
   `branchName`, `title`, and `questionsRequired` checks have real values.
2. **CREW-66-002** — senior-engineer extracts artefacts so the peer-review
   loop receives real `comments`.
3. **CREW-66-003** — MCP versions are pinned so agent invocations don't
   silently change behaviour mid-run.
4. **CREW-66-004** — `createMr` is idempotent so a retry does not produce
   duplicates.
5. **CREW-66-005** — webhook in-flight 429 closes the only remaining
   concurrency hole.
6. **CREW-67-001** — `pnpm diagnose` confirms the target environment is
   correct before the first run.
7. **CREW-67-002** — `workflow.complete` log captures cost and duration so
   we can read what happened.
8. **CREW-67-005** — actually run a story end-to-end.

CREW-66-006, CREW-66-007, CREW-67-003, and CREW-67-004 follow once the
slice is proven. They harden the system against the long tail of cases the
first run did not exercise.

## 8. Assumptions

| ID | Assumption | Impact if wrong |
| --- | --- | --- |
| A1 | The engineer and senior-engineer skill prompts are sufficient to elicit the JSON artefact envelope (current `prompt.md` and `SKILL.md` files document the contract) | Without reliable JSON output the parser in CREW-66-001/002 falls back to `success: false` repeatedly; mitigation is to add an explicit "respond ONLY in JSON" instruction at the end of each skill's Output contract section if needed |
| A2 | `JIRA_ASSIGNEE_ACCOUNT_ID` is a Jira account ID (not display name) usable in JQL `assignee = "..."` queries | Wrong format causes the poller's JQL to return no results; CREW-67-001 catches this in the project-reachability check |
| A3 | The Jira board exposes the four transition names exactly as written: `In Progress`, `Clarification Needed`, `In QA`, `Needs human review` | `transitionIssue()` silently no-ops on a name miss; CREW-67-001 transitions check catches this before deploy |
| A4 | The Railway persistent volume at `DB_PATH` survives restarts so crash recovery (already shipped in CREW-63-003) remains meaningful | Without persistence the SQLite state is ephemeral and the recovery scan is a no-op |
| A5 | The first e2e run uses a sandbox Jira project + GitLab project so a failed run does not affect a production board | Without a sandbox the first run's failure modes ship visible work into a real backlog; mitigation is to gate CREW-67-005 on having a sandbox configured |

## 9. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Agent does not consistently emit valid JSON in `resultMsg.result`, causing CREW-66-001/002 to downgrade most runs to `success: false` | Medium | High | First-line: tighten the skill's Output contract to explicitly say "respond ONLY with the JSON object — no surrounding prose". Second-line: parse the longest JSON-shaped substring, not the whole result, before failing. |
| R2 | The pinned MCP version (CREW-66-003) breaks against the SDK's expected protocol after a future SDK upgrade | Low | Medium | Pin in a single place; on SDK upgrade, run `pnpm diagnose` (which boots the MCP servers) before merging. |
| R3 | `getPipelineStatus` via GitLab MCP returns stale pipeline data due to caching | Low | Medium | Verify response freshness during the e2e run (CREW-67-005); fall back to direct REST call if stale. |
| R4 | First e2e run reveals an agent-tool gap (e.g. engineer needs a tool not in the allowlist) | Medium | Medium | The escalation path catches the failure cleanly; CREW-67-005 explicitly accepts an escalation outcome and requires a follow-up story rather than treating it as a blocker. |
| R5 | Cost-per-run on a real story exceeds expected budget by an order of magnitude | Low | High | CREW-67-002's `workflow.complete` log is the first place we see this; tighten `REFACTOR_LOOP_CAP` and `CI_RETRY_CAP` defaults if the first run is materially over budget. |

## 10. Definition of Done

A story in this backlog is done when:

- [ ] All EARS acceptance statements hold and every Gherkin scenario passes.
- [ ] `pnpm typecheck` passes with zero new errors.
- [ ] `pnpm lint` passes with no new dependency-cruiser violations.
- [ ] `pnpm test` passes with no new failures; new behaviour has ≥ 80%
      branch coverage.
- [ ] New env vars (if any) documented in `crews/delivery-build/.env.example`
      and `crews/delivery-build/README.md`.
- [ ] `AGENTS.md` updated if the repo's public surface or conventions
      changed.
- [ ] PR merged to `main` via the GitHub Actions CI pipeline.

## 11. Handoff

When CREW-66 closes, the workflow is functionally complete and idempotent.
When CREW-67 closes, the slice has been validated against a real Jira board
and GitLab project, with a runbook and observability in place to operate
unattended.

After CREW-67-005 succeeds:

- `delivery-review` fast-follows with the `tech-lead` persona (final code
  review, MR merge, Jira close).
- `delivery-qa` follows with the `qa-engineer` persona — its trigger is the
  `In QA` transition emitted at the end of `delivery-build`.
- The remediation re-entry path opens once `delivery-qa` exists.
- `product.md §7` autonomy rate and cost-per-run metrics get their first
  data points from CREW-67-002 logs.

---

## 12. Completed work (provenance)

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
| CREW-63-008 | In-flight lock (poller side) | Partial | Poller owns an `inFlight` set; webhook side rolled into CREW-66-005 |
| CREW-64-001 | `corepack enable` | Done | `crews/delivery-build/Dockerfile` |
| CREW-64-002 | GitHub Actions CI | Done | `.github/workflows/ci.yml` runs lint, typecheck, test on push and PR to `main` |
| CREW-64-003 | Explicit Dockerfile lockfile COPY | Done | `COPY pnpm-lock.yaml ./` without glob |
| CREW-64-004 | `PROJECT_DIR` and `ANTHROPIC_MODEL` documented | Done | Listed in `.env.example` and `README.md` |
| CREW-64-005 | Test mock cleanup | Done | No `db: {} as never` in `tests/` |
| CREW-64-007 | Loop-bound asymmetry comment | Done | Documented in `workflow.ts` and `AGENTS.md` |

The unfinished CREW-63 and CREW-64 stories carry forward into CREW-66:

- CREW-63-004 (pin MCP versions) → **CREW-66-003**
- CREW-63-007 (`createMr` idempotency) → **CREW-66-004**
- CREW-63-008 (webhook in-flight lock — webhook side) → **CREW-66-005**
- CREW-63-009 (`getMrDiff` size cap) → **CREW-66-006**
- CREW-64-006 (`extractMrIid` validation) → **CREW-66-007**

---

## 13. Future backlog

### F-01 -- Shared team memory across personas

Each persona currently writes to its own `memory: 'project'` directory.
After three or more stories complete end-to-end, add a shared read path so
the engineer can see patterns the senior engineer has flagged without
direct inter-persona communication.

**Priority.** Post-operational. Depends on CREW-67 completing.

---

### F-02 -- Remediation re-entry path

Delivery-build v2: the poller picks up `In Remediation` + `qa-remediation`
label tickets, reads QA defect notes, fixes on branch, re-runs CI, removes
the label, and re-transitions to `In QA`. Requires the `delivery-qa` crew
to exist.

**Priority.** After `delivery-qa` ships.

---

### F-03 -- `delivery-review` crew

`tech-lead` persona: architecture gate, PM HITL pause, MR approval +
merge, Jira close. Triggered by polling `In QA` tickets (or
`ready-for-review` signal from `delivery-qa`).

**Priority.** Fast-follow once CREW-67-005 demonstrates the slice.

---

### F-04 -- Observability stack

OpenTelemetry tracing across the workflow, structured log shipping to a
managed log store, dashboards keyed on `workflow.complete` and
`workflow.escalate`. Currently CREW-67-002's structured log is the
substitute. Move to a real telemetry stack once a second crew is operating
and per-crew dashboards are needed.

**Priority.** Next phase, once two or more crews are running.

---

### F-05 -- Durable cross-crew orchestration

Per `product.md §2 Future`: a coordination layer above individual crews
for fan-out, fan-in, and pipelines that span hours or days. This sits
above `delivery-build`, `delivery-qa`, and `delivery-review` rather than
inside any of them.

**Priority.** Future phase. Out of scope until at least three crews are in
production.
