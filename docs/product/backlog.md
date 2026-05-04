---
type: Backlog
scope: product
product: crew-runtime
version: '1.0'
owner: daddia
status: Refined
last_updated: 2026-05-05
source_review: docs/reviews/20260504-solution-review.md
related:
  - docs/reviews/20260504-solution-review.md
  - AGENTS.md
---

# Backlog -- Crew Runtime (review remediation)

Story-level backlog derived from the [`20260504-solution-review.md`](../reviews/20260504-solution-review.md) codebase review. Every story maps to one or more numbered issues in that review document; the review issue numbers appear in the `Labels` field as `review:#n`.

- **Review source:** `docs/reviews/20260504-solution-review.md`
- **AGENTS.md:** `AGENTS.md`
- **Dependency rules:** `pnpm lint` (dependency-cruiser), `pnpm typecheck`, `pnpm test` — enforced on every PR

## 1. Summary

**Objective.** Address the 25 issues identified in the 2026-05-04 solution review and bring the Crew runtime to a production-ready baseline. The core blocker is that no agent `run()` method is implemented and `resolveSession()` returns a random UUID — the system is otherwise well-architected scaffolding waiting for the SDK wire-up.

**Delivery approach.** P0 stories (SDK wire-up, container fix) are the critical prerequisite — nothing downstream can be validated until agents execute. P1 stories (CI, startup validation, crash recovery, state integrity) form the hardening layer that makes the system safe to leave running. P2 stories (code quality) remove confusion and maintenance noise. P3 stories (observability, rate limiting) harden the running system.

**Prerequisites (complete).** Webhook security, SQLite schema, workflow orchestration, state machine, test coverage on orchestration layer — all production-quality and do not need to change.

**Out of scope.** New features, persona additions, new workflow phases — this backlog contains only remediation of the 25 review issues.

## 2. Conventions

| Convention | Value |
| --- | --- |
| Epic ID format | `CREW-{nn}` (continuing from product backlog) |
| Story ID format | `CREW-{nn}-{nnn}` |
| Status values | Not started, In progress, In review, Done, Blocked |
| Priority levels | P0 (blocking), P1 (reliability), P2 (quality), P3 (hardening) |
| Estimation | Fibonacci story points (1, 2, 3, 5, 8) |
| Review traceability | `review:#n` label maps to the issue number in `20260504-solution-review.md` |
| Acceptance format | EARS + Gherkin |

## 3. Epic breakdown

| Epic | Title | Priority | Deps | Points | Status |
| --- | --- | --- | --- | --- | --- |
| CREW-50 | SDK session wire-up | P0 | — | 18 | Not started |
| CREW-51 | Container, CI, and deploy hygiene | P0/P1 | — | 5 | Not started |
| CREW-52 | Startup reliability and crash recovery | P1 | CREW-50 | 8 | Not started |
| CREW-53 | State and data integrity | P1 | — | 6 | Not started |
| CREW-54 | Code quality and hygiene | P2 | — | 8 | Not started |
| CREW-55 | Observability and hardening | P3 | CREW-50, CREW-52 | 15 | Not started |
| **Total** | | | | **60** | |

Now epics (CREW-50 through CREW-53) have full story detail below. CREW-54 and CREW-55 have full story detail as well — no later-phase placeholders since all scope is known from the review.

## 4. Epic detail

---

### CREW-50 -- SDK session wire-up

**Scope.** Wire `resolveSession()` and all four persona `run()` implementations to the `@anthropic-ai/claude-code` SDK. Until this epic closes the system is inert: every agent invocation throws immediately. `subagentPaths` consumption is also resolved here since it only has meaning once sessions are live. Project memory is activated here so the crew builds up cross-run knowledge from the first story.

**Key deliverables.** `packages/crew/src/session.ts` `resolveSession()` calling `unstable_v2_createSession()` for new sessions and `unstable_v2_resumeSession()` for existing ones; the Claude Code SDK owns the full conversation transcript in its own JSONL files — Crew stores only the `sessionId` as a resume key; `isResumed` path maintained so the engineer's address-feedback loop preserves session context across turns; `AgentResult` populated from SDK response; `engineer`, `senior-engineer`, `tech-lead`, and `code-quality` persona `run()` implementations each building `AgentDefinition` with `memory: 'project'` set, calling `resolveSession()`, and returning a structured `AgentResult`; `subagentPaths` read and injected into the session as subagent system prompts; initial project memory seeded on first run (CREW-50-007).

**Dependencies.** None.

**Status.** Not started.

**Branch.** `fix/CREW-50-sdk-session`

---

- [ ] **[CREW-50-001] Wire `resolveSession()` to the Claude Code SDK**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 5
  - **Epic:** CREW-50 | **Labels:** review:#1, review:#2, type:infrastructure
  - **Depends on:** —
  - **Deliverable:** `packages/crew/src/session.ts` `resolveSession()` calls `unstable_v2_createSession()` when no prior `sessionId` exists for the given `issueKey`, and `unstable_v2_resumeSession(sessionId)` when one does; the Claude Code SDK owns the full conversation transcript in its own JSONL files under `~/.claude/projects/` — Crew stores only the `sessionId` in the `phases` table as a resume key and does not duplicate the transcript; `isResumed: true` is returned on the resume path so the address-feedback loop can detect it; `resolveSession()` no longer returns `crypto.randomUUID()` without a real SDK call; unit tests covering create-path, resume-path, and SDK error propagation.
  - **Acceptance (EARS):**
    - WHEN `resolveSession()` is called with no prior `sessionId` for the given `issueKey`, THE SYSTEM SHALL call `unstable_v2_createSession()` and return `{ sessionId, isResumed: false }`.
    - WHEN `resolveSession()` is called and a `sessionId` already exists for the given `issueKey`, THE SYSTEM SHALL call `unstable_v2_resumeSession(sessionId)` and return `{ sessionId, isResumed: true }`.
    - WHEN the SDK returns an error during session creation or resumption, THE SYSTEM SHALL propagate the error to the caller and SHALL NOT return a random UUID as a fallback.
    - THE SYSTEM SHALL NOT call `crypto.randomUUID()` as the sole source of a `sessionId` return value.
    - THE SYSTEM SHALL store only the `sessionId` in Crew's `phases` table; it SHALL NOT store the conversation transcript.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: New session is created via unstable_v2_createSession
      Given no sessionId exists for issueKey "CREW-50-001"
      When resolveSession() is called for issueKey "CREW-50-001"
      Then unstable_v2_createSession() is invoked
      And the returned sessionId matches the SDK-assigned session identifier
      And isResumed is false

    Scenario: Existing session is resumed via unstable_v2_resumeSession
      Given a sessionId "sess_abc" is stored for issueKey "CREW-50-001"
      When resolveSession() is called for issueKey "CREW-50-001"
      Then unstable_v2_resumeSession("sess_abc") is invoked
      And isResumed is true

    Scenario: SDK error propagates to caller
      Given the SDK throws a network error during session creation
      When resolveSession() is called
      Then the error is re-thrown to the caller
      And no random UUID is returned
    ```

---

- [ ] **[CREW-50-002] Implement `engineer` persona `run()`**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 3
  - **Epic:** CREW-50 | **Labels:** review:#1, type:feature
  - **Depends on:** CREW-50-001
  - **Deliverable:** `agents/delivery/src/agents/engineer/agent.ts` `run()` builds `AgentDefinition` from `promptPath`, `skillPaths`, `subagentPaths`, `allowedTools`, `mcpServerNames`, and `memory: 'project'`; calls `resolveSession()` from `@daddia/crew`; executes the session using the SDK; returns a populated `AgentResult` with `success`, `summary`, `artefacts`, and `costUsd`; `buildAuditHook()` attached for every run; the function no longer throws `"not implemented"`. Setting `memory: 'project'` causes the SDK to create and maintain a persistent project memory directory, inject Read/Write/Edit tools into the session, and load `MEMORY.md` into context automatically.
  - **Acceptance (EARS):**
    - WHEN `engineer.run(input)` is called, THE SYSTEM SHALL build an `AgentDefinition` using the engineer's `prompt.md`, discovered skill paths, allowed tools list, MCP server names, and `memory: 'project'`.
    - WHEN `engineer.run(input)` is called, THE SYSTEM SHALL call `resolveSession()` and pass the resulting `sessionId` to the SDK execution call.
    - WHEN the SDK completes execution, THE SYSTEM SHALL return an `AgentResult` where `success` is `true`, `summary` is non-empty, and `costUsd` reflects the SDK-reported token cost.
    - WHEN the SDK returns an error, THE SYSTEM SHALL return an `AgentResult` where `success` is `false` and `summary` contains the error message.
    - THE SYSTEM SHALL attach `buildAuditHook()` to every `engineer.run()` invocation.
    - THE SYSTEM SHALL NOT throw `Error("not implemented")` or any placeholder error during `engineer.run()`.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Engineer run completes successfully
      Given a valid AgentInput with issueKey "CREW-50-001"
      And the SDK session executes without error
      When engineer.run(input) is called
      Then an AgentResult is returned with success true
      And summary is a non-empty string
      And costUsd is a non-negative number

    Scenario: Engineer run surfaces SDK failure
      Given a valid AgentInput
      And the SDK session throws a rate-limit error
      When engineer.run(input) is called
      Then an AgentResult is returned with success false
      And summary contains the error description

    Scenario: Audit hook is attached on every run
      Given a valid AgentInput
      When engineer.run(input) is called
      Then buildAuditHook() was called once before SDK execution
    ```

---

- [ ] **[CREW-50-003] Implement `senior-engineer` persona `run()`**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 2
  - **Epic:** CREW-50 | **Labels:** review:#1, type:feature
  - **Depends on:** CREW-50-001
  - **Deliverable:** `agents/delivery/src/agents/senior-engineer/agent.ts` `run()` follows the same pattern as CREW-50-002; builds `AgentDefinition` from persona-specific paths, tools, and `memory: 'project'`; calls `resolveSession()`; returns populated `AgentResult`; `buildAuditHook()` attached; no longer throws.
  - **Acceptance (EARS):**
    - WHEN `seniorEngineer.run(input)` is called, THE SYSTEM SHALL build an `AgentDefinition` using the senior-engineer's `prompt.md`, skill paths, allowed tools, MCP server names, and `memory: 'project'`.
    - WHEN the SDK completes execution, THE SYSTEM SHALL return an `AgentResult` with `success`, `summary`, `artefacts`, and `costUsd` populated.
    - THE SYSTEM SHALL NOT throw `Error("not implemented")` during `seniorEngineer.run()`.
    - THE SYSTEM SHALL attach `buildAuditHook()` to every invocation.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Senior engineer run returns populated AgentResult
      Given a valid AgentInput for a peer-review task
      And the SDK executes successfully
      When seniorEngineer.run(input) is called
      Then an AgentResult is returned with success true and non-empty summary

    Scenario: No placeholder error is thrown
      Given a valid AgentInput
      When seniorEngineer.run(input) is called
      Then no "not implemented" error is thrown
    ```

---

- [ ] **[CREW-50-004] Implement `tech-lead` persona `run()`**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 2
  - **Epic:** CREW-50 | **Labels:** review:#1, type:feature
  - **Depends on:** CREW-50-001
  - **Deliverable:** `agents/delivery/src/agents/tech-lead/agent.ts` `run()` builds `AgentDefinition` with `memory: 'project'`; calls `resolveSession()`; returns populated `AgentResult`; `buildAuditHook()` attached; no longer throws.
  - **Acceptance (EARS):**
    - WHEN `techLead.run(input)` is called, THE SYSTEM SHALL build an `AgentDefinition` using the tech-lead's `prompt.md`, skill paths, allowed tools, MCP server names, and `memory: 'project'`.
    - WHEN the SDK completes execution, THE SYSTEM SHALL return an `AgentResult` with all fields populated.
    - THE SYSTEM SHALL NOT throw `Error("not implemented")` during `techLead.run()`.
    - THE SYSTEM SHALL attach `buildAuditHook()` to every invocation.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Tech lead run returns populated AgentResult
      Given a valid AgentInput for a final-code-review task
      And the SDK executes successfully
      When techLead.run(input) is called
      Then an AgentResult is returned with success true and non-empty summary

    Scenario: No placeholder error is thrown
      Given a valid AgentInput
      When techLead.run(input) is called
      Then no "not implemented" error is thrown
    ```

---

- [ ] **[CREW-50-005] Implement `code-quality` persona `run()`**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 2
  - **Epic:** CREW-50 | **Labels:** review:#1, type:feature
  - **Depends on:** CREW-50-001
  - **Deliverable:** `agents/code-reviewer/src/agents/code-quality/agent.ts` `run()` builds `AgentDefinition` with `memory: 'project'`; calls `resolveSession()`; returns populated `AgentResult`; `buildAuditHook()` attached; no longer throws.
  - **Acceptance (EARS):**
    - WHEN `codeQuality.run(input)` is called, THE SYSTEM SHALL build an `AgentDefinition` using the code-quality `prompt.md`, skill paths, allowed tools, MCP server names, and `memory: 'project'`.
    - WHEN the SDK completes execution, THE SYSTEM SHALL return an `AgentResult` with all fields populated.
    - THE SYSTEM SHALL NOT throw `Error("not implemented")` during `codeQuality.run()`.
    - THE SYSTEM SHALL attach `buildAuditHook()` to every invocation.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Code quality run returns populated AgentResult
      Given a valid AgentInput for a code-review task
      And the SDK executes successfully
      When codeQuality.run(input) is called
      Then an AgentResult is returned with success true and non-empty summary

    Scenario: No placeholder error is thrown
      Given a valid AgentInput
      When codeQuality.run(input) is called
      Then no "not implemented" error is thrown
    ```

---

- [ ] **[CREW-50-006] Thread `subagentPaths` into SDK session**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-50 | **Labels:** review:#12, type:feature
  - **Depends on:** CREW-50-001
  - **Deliverable:** `packages/crew/src/loaders.ts` `readSubagentsDir()` output is read and passed to the SDK session as subagent system prompts (or the equivalent SDK concept for `.claude/agents/` files); each persona `run()` implementation passes `subagentPaths` from its `AgentDefinition` through to the session invocation; integration test confirming subagent files are loaded and injected when present; when `subagentPaths` is empty the session still starts without error.
  - **Acceptance (EARS):**
    - WHEN `subagentPaths` in an `AgentDefinition` is non-empty, THE SYSTEM SHALL read each file and inject its contents into the SDK session as a subagent definition before invoking the session.
    - WHEN `subagentPaths` is empty, THE SYSTEM SHALL start the SDK session without error and without attempting to read any subagent files.
    - WHEN a path in `subagentPaths` does not exist on disk, THE SYSTEM SHALL log a `warn`-level message and continue session creation without that subagent.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Subagent files are injected into the session
      Given an AgentDefinition with subagentPaths containing one valid .md file
      When resolveSession() is called
      Then the contents of the .md file are injected into the SDK session as a subagent definition

    Scenario: Empty subagentPaths does not break session creation
      Given an AgentDefinition with an empty subagentPaths array
      When resolveSession() is called
      Then the SDK session starts without error

    Scenario: Missing subagent file is skipped with a warning
      Given an AgentDefinition with a subagentPath pointing to a non-existent file
      When resolveSession() is called
      Then a warn-level log is emitted for the missing path
      And the session starts with the remaining subagents (if any)
    ```

---

- [ ] **[CREW-50-007] Seed initial project memory on first run**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-50 | **Labels:** type:feature
  - **Depends on:** CREW-50-002
  - **Deliverable:** On the first run for a project (when `MEMORY.md` does not yet exist in the SDK's project memory directory), the engineer persona writes an initial memory file covering observable project context: language and runtime, package manager, test framework, coding conventions visible from the codebase, and any patterns in `AGENTS.md`. This bootstraps the memory system so it is useful from run one rather than accumulating gradually. The seed write is skipped on subsequent runs where `MEMORY.md` already exists.
  - **Acceptance (EARS):**
    - WHEN the delivery agent runs its first story for a project and no `MEMORY.md` exists in the project memory directory, THE SYSTEM SHALL write an initial memory file recording observable project context before the first `engineer.run()` call.
    - WHEN `MEMORY.md` already exists in the project memory directory, THE SYSTEM SHALL skip the seed write and proceed normally.
    - WHEN the seed write fails, THE SYSTEM SHALL log a `warn`-level message and continue without blocking the workflow.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Memory is seeded on first run
      Given no MEMORY.md exists in the project memory directory
      When the delivery agent processes its first story
      Then an initial MEMORY.md is written before engineer.run() is called
      And the file contains at least one entry describing the project's language or tooling

    Scenario: Seed is skipped when memory already exists
      Given MEMORY.md already exists in the project memory directory
      When the delivery agent processes a story
      Then no seed write is attempted
      And the workflow proceeds normally

    Scenario: Seed failure does not block the workflow
      Given the memory directory is not writable
      When the delivery agent attempts to seed memory
      Then a warn-level log is emitted
      And engineer.run() is called regardless
    ```

---

### CREW-51 -- Container, CI, and deploy hygiene

**Scope.** Three targeted fixes that make builds reproducible and protected: fix the pnpm version mismatch in the code-reviewer Dockerfile, add a GitHub Actions CI pipeline, and make the Dockerfile `COPY` for the lockfile explicit.

**Key deliverables.** `agents/code-reviewer/Dockerfile` using `corepack enable` instead of `pnpm@9`; `.github/workflows/ci.yml` running lint, typecheck, and test on push and pull request; both Dockerfiles using a plain `COPY pnpm-lock.yaml ./` without the optional glob suffix.

**Dependencies.** None.

**Status.** Not started.

---

- [ ] **[CREW-51-001] Fix code-reviewer Dockerfile to use `corepack enable`**
  - **Status:** Not started | **Priority:** P0 | **Estimate:** 1
  - **Epic:** CREW-51 | **Labels:** review:#3, type:infrastructure
  - **Depends on:** —
  - **Deliverable:** `agents/code-reviewer/Dockerfile` line 2 changed from `RUN npm install -g pnpm@9` to `RUN corepack enable`; `pnpm install --frozen-lockfile` succeeds against the existing `pnpm-lock.yaml` (pnpm 10 lockfile format) in CI and local Docker builds.
  - **Acceptance (EARS):**
    - WHEN the code-reviewer Docker image is built, THE SYSTEM SHALL use `corepack enable` to activate the pnpm version declared in `packageManager` in `package.json`.
    - WHEN `pnpm install --frozen-lockfile` runs inside the built image, THE SYSTEM SHALL complete without a lockfile format version mismatch error.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Code-reviewer image builds with pnpm 10
      Given the code-reviewer Dockerfile uses corepack enable
      When docker build runs for agents/code-reviewer
      Then the build completes without error
      And pnpm install --frozen-lockfile succeeds inside the container

    Scenario: pnpm version matches workspace packageManager field
      Given the Dockerfile activates pnpm via corepack
      When pnpm --version is called inside the container
      Then the reported version matches the packageManager field in package.json
    ```

---

- [ ] **[CREW-51-002] Add GitHub Actions CI pipeline**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-51 | **Labels:** review:#4, type:infrastructure
  - **Depends on:** —
  - **Deliverable:** `.github/workflows/ci.yml` that triggers on `push` and `pull_request` to `main`; runs `pnpm install --frozen-lockfile`, `pnpm lint` (dependency-cruiser boundary checks), `pnpm typecheck`, and `pnpm test`; fails the workflow if any command exits non-zero; Node.js version pinned to match `.nvmrc` or `engines` in `package.json`; pnpm version activated via `corepack enable`; workflow caches `~/.pnpm-store` keyed on `pnpm-lock.yaml` hash.
  - **Acceptance (EARS):**
    - WHEN a commit is pushed to `main` or a pull request targets `main`, THE SYSTEM SHALL trigger the CI workflow.
    - WHEN `pnpm lint` exits non-zero, THE SYSTEM SHALL fail the CI workflow and report the lint errors.
    - WHEN `pnpm typecheck` exits non-zero, THE SYSTEM SHALL fail the CI workflow and report the type errors.
    - WHEN `pnpm test` exits non-zero, THE SYSTEM SHALL fail the CI workflow and report the failing tests.
    - WHEN all three commands exit zero, THE SYSTEM SHALL mark the CI workflow as passed.
    - THE SYSTEM SHALL cache the pnpm store between runs to reduce install time.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Clean codebase passes CI
      Given a commit with no lint, type, or test errors
      When the CI workflow runs
      Then all three steps (lint, typecheck, test) exit zero
      And the workflow is marked as passed

    Scenario: Dependency boundary violation fails CI
      Given a commit where packages/crew imports from agents/delivery
      When pnpm lint runs in CI
      Then dependency-cruiser reports a boundary violation
      And the CI workflow fails

    Scenario: Type error fails CI
      Given a commit introducing a TypeScript type mismatch
      When pnpm typecheck runs in CI
      Then the workflow fails and the type error is reported

    Scenario: pnpm store is cached between runs
      Given a prior CI run has populated the cache
      When a subsequent CI run restores the cache
      Then pnpm install skips redownloading already-cached packages
    ```

---

- [ ] **[CREW-51-003] Fix Dockerfile lockfile `COPY` from glob to explicit**
  - **Status:** Not started | **Priority:** P3 | **Estimate:** 1
  - **Epic:** CREW-51 | **Labels:** review:#22, type:infrastructure
  - **Depends on:** —
  - **Deliverable:** Both `agents/delivery/Dockerfile` and `agents/code-reviewer/Dockerfile` changed from `COPY pnpm-lock.yaml* ./` to `COPY pnpm-lock.yaml ./`; the intent is explicit and `--frozen-lockfile` will error loudly rather than silently install without a lockfile.
  - **Acceptance (EARS):**
    - WHEN the Dockerfile is evaluated, THE SYSTEM SHALL use `COPY pnpm-lock.yaml ./` without an optional glob suffix in both agent Dockerfiles.
    - WHEN `pnpm-lock.yaml` is absent during a Docker build, THE SYSTEM SHALL fail the build at the `COPY` step rather than silently proceeding.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Lockfile is copied explicitly
      Given agents/delivery/Dockerfile and agents/code-reviewer/Dockerfile
      When the COPY instruction for the lockfile is inspected
      Then it reads "COPY pnpm-lock.yaml ./" without a wildcard suffix
    ```

---

### CREW-52 -- Startup reliability and crash recovery

**Scope.** Four changes that make the runtime safe to deploy and restart without silent failure. Startup env validation catches misconfiguration before any request is handled. Moving the auth header construction inside `jiraFetch()` ensures validation runs before credentials are encoded. Crash-recovery detects and re-queues interrupted phases on restart. Pinning MCP server versions prevents silent prod breakage on upstream updates.

**Key deliverables.** `agents/delivery/src/index.ts` eager env validation block; Jira auth header moved into `jiraFetch()`; startup scan over `phases` rows with `started_at IS NOT NULL AND finished_at IS NULL`; both `mcp.json` files with pinned version strings.

**Dependencies.** CREW-50-001 (the SDK must be wired before crash-recovery is worth testing end-to-end, but the scan itself can be written independently).

**Status.** Not started.

---

- [ ] **[CREW-52-001] Add startup env var validation to `index.ts`**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-52 | **Labels:** review:#7, type:reliability
  - **Depends on:** —
  - **Deliverable:** `agents/delivery/src/index.ts` checks `ANTHROPIC_API_KEY`, `ATLASSIAN_BASE_URL`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `GITLAB_PERSONAL_ACCESS_TOKEN`, `JIRA_WEBHOOK_SECRET`, and `GITLAB_WEBHOOK_SECRET` before the Hono server starts; if any are absent, logs the missing keys at `error` level and calls `process.exit(1)`.
  - **Acceptance (EARS):**
    - WHEN the server starts and one or more required env vars are absent, THE SYSTEM SHALL log the names of all missing vars at `error` level and exit with code 1 before accepting any requests.
    - WHEN all required env vars are present, THE SYSTEM SHALL start the server normally without logging an error.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Missing env var causes immediate exit
      Given ANTHROPIC_API_KEY is not set
      When the delivery agent starts
      Then a structured error log is emitted listing "ANTHROPIC_API_KEY" as missing
      And the process exits with code 1 before the server binds

    Scenario: All env vars present -- server starts normally
      Given all seven required env vars are set to non-empty values
      When the delivery agent starts
      Then no error-level env validation log is emitted
      And the server binds and accepts requests
    ```

---

- [ ] **[CREW-52-002] Move Jira auth header construction inside `jiraFetch()`**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 1
  - **Epic:** CREW-52 | **Labels:** review:#17, type:reliability
  - **Depends on:** CREW-52-001
  - **Deliverable:** `agents/delivery/src/integrations/jira.ts` constant `authHeader` moved from module-load scope into `jiraFetch()` body; the Base64 encoding of `:` on empty credentials is no longer silently baked in at import time; startup validation (CREW-52-001) runs before any `jiraFetch()` call is made.
  - **Acceptance (EARS):**
    - WHEN `agents/delivery/src/integrations/jira.ts` is imported, THE SYSTEM SHALL NOT evaluate `Buffer.from(...).toString("base64")` using the env vars at module-load time.
    - WHEN `jiraFetch()` is called, THE SYSTEM SHALL construct the `Authorization` header from the current values of `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN` at call time.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Auth header is constructed at call time not import time
      Given jira.ts is imported before env vars are validated
      When jira.ts module is evaluated
      Then no Buffer.from encode of credentials occurs at module scope

    Scenario: jiraFetch uses current env var values
      Given ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN are set to valid values
      When jiraFetch() constructs the Authorization header
      Then the header encodes the current values of those env vars
    ```

---

- [ ] **[CREW-52-003] Implement startup crash-recovery scan**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 5
  - **Epic:** CREW-52 | **Labels:** review:#8, type:reliability
  - **Depends on:** CREW-50-001
  - **Deliverable:** `agents/delivery/src/index.ts` (or a dedicated `recovery.ts`) runs a scan on startup over `phases` rows where `started_at IS NOT NULL AND finished_at IS NULL`; for each interrupted row the `session_id` is read from the database and passed to `unstable_v2_resumeSession(sessionId)` so the agent resumes the exact conversation context rather than starting a fresh session; the recovered workflow is re-dispatched from the interrupted phase; the recovery scan result is logged at `info` level with the `issueKey`, `phase`, and `sessionId` of each recovered row; if no interrupted phases are found the scan exits silently. The Claude Code SDK's conversation transcript on disk provides the agent's full prior context on resume — Crew's database provides only the `sessionId` needed to address it.
  - **Acceptance (EARS):**
    - WHEN the server starts and the `phases` table contains one or more rows with `started_at IS NOT NULL AND finished_at IS NULL`, THE SYSTEM SHALL treat each such row as an interrupted phase and call `unstable_v2_resumeSession(sessionId)` using the stored `session_id`.
    - WHEN the server starts and no interrupted phases exist, THE SYSTEM SHALL complete the scan without logging at `warn` or `error` level.
    - WHEN the recovery scan resumes a phase, THE SYSTEM SHALL log at `info` level the `issueKey`, `phase`, `started_at`, and `sessionId` of the recovered row.
    - WHEN `unstable_v2_resumeSession()` fails for a recovered row, THE SYSTEM SHALL log a `warn`-level message and escalate that story to human review rather than silently dropping it.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Interrupted phase is resumed via session ID on startup
      Given a phases row for issueKey "CREW-50-001" with started_at set, finished_at null, and session_id "sess_abc"
      When the delivery agent restarts
      Then the recovery scan detects the interrupted row
      And unstable_v2_resumeSession("sess_abc") is called
      And an info log is emitted with issueKey "CREW-50-001", the phase name, and "sess_abc"

    Scenario: No interrupted phases -- scan exits silently
      Given the phases table has no rows with finished_at null
      When the delivery agent starts
      Then the recovery scan completes without any warn or error log

    Scenario: Multiple interrupted phases are all resumed
      Given three phases rows with started_at set and finished_at null
      When the delivery agent restarts
      Then unstable_v2_resumeSession() is called once per interrupted row
      And three info log lines are emitted

    Scenario: Session resumption failure escalates to human review
      Given an interrupted phase row with session_id "sess_gone"
      And unstable_v2_resumeSession("sess_gone") throws an error
      When the recovery scan runs
      Then a warn-level log is emitted for the failed resumption
      And the story is transitioned to "Needs human review"
    ```

---

- [ ] **[CREW-52-004] Pin MCP server versions in `mcp.json`**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-52 | **Labels:** review:#9, type:reliability
  - **Depends on:** —
  - **Deliverable:** `agents/delivery/mcp.json` and `agents/code-reviewer/mcp.json` updated so `@anthropic-ai/mcp-server-gitlab` and `@anthropic-ai/mcp-server-atlassian` are pinned to specific version strings (e.g. `@anthropic-ai/mcp-server-gitlab@1.2.3`); `npx -y` no longer downloads the latest version on every agent invocation.
  - **Acceptance (EARS):**
    - WHEN the MCP server config is read, THE SYSTEM SHALL reference the MCP server packages with explicit version strings rather than unversioned package names.
    - WHEN a new version of `mcp-server-gitlab` or `mcp-server-atlassian` is published, THE SYSTEM SHALL NOT automatically upgrade unless the version string in `mcp.json` is explicitly updated.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: MCP server args include pinned version
      Given agents/delivery/mcp.json and agents/code-reviewer/mcp.json
      When the args array for the mcp-server-gitlab entry is inspected
      Then the package name includes a version specifier (e.g. @1.2.3)

    Scenario: Unpinned package name is absent
      Given both mcp.json files
      When they are inspected for unversioned package references
      Then no entry reads "-y", "@anthropic-ai/mcp-server-gitlab" without a version
    ```

---

### CREW-53 -- State and data integrity

**Scope.** Three targeted fixes to the SQLite layer and the GitLab integration. Consolidate dual connections to the same DB file. Fix `finishPhase()` to filter on the `phase` column so replay scenarios update the right row. Add an idempotency guard to `createMr()` to prevent duplicate MR creation on workflow replay.

**Key deliverables.** Single `DatabaseSync` connection passed from `createStateStore()` to the idempotency logic; `finishPhaseStmt` updated to `WHERE issue_key = ? AND phase = ? AND finished_at IS NULL`; `createMr()` calling `GET /merge_requests?source_branch=<branchName>` before `POST /merge_requests` and returning the existing MR URL if found.

**Dependencies.** None.

**Status.** Not started.

---

- [ ] **[CREW-53-001] Consolidate dual SQLite connections**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 2
  - **Epic:** CREW-53 | **Labels:** review:#5, type:reliability
  - **Depends on:** —
  - **Deliverable:** `agents/delivery/src/idempotency.ts` `getIdempotency()` no longer opens a second `DatabaseSync` connection to `DB_PATH`; the existing `db` instance from `createStateStore()` is passed into `createIdempotencyStore()` (or `getIdempotency()` is merged into the state store); there is exactly one `DatabaseSync` connection to `DB_PATH` at runtime; the `webhook_events` table is created once, not twice; all existing tests pass.
  - **Acceptance (EARS):**
    - WHEN the delivery agent starts, THE SYSTEM SHALL open exactly one `DatabaseSync` connection to `DB_PATH`.
    - WHEN the `webhook_events` table is initialised, THE SYSTEM SHALL create it once using the single shared connection.
    - WHEN `createStateStore()` and the idempotency store are both initialised, THE SYSTEM SHALL share the same underlying `DatabaseSync` instance.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Only one database connection is opened
      Given DB_PATH is set to a valid file path
      When the delivery agent initialises the state store and idempotency store
      Then only one DatabaseSync connection to DB_PATH is created

    Scenario: webhook_events table is created once
      Given the shared connection is used for both state and idempotency
      When the schema is initialised
      Then CREATE TABLE IF NOT EXISTS webhook_events executes exactly once
    ```

---

- [ ] **[CREW-53-002] Fix `finishPhase()` to filter on phase column**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 1
  - **Epic:** CREW-53 | **Labels:** review:#6, type:correctness
  - **Depends on:** —
  - **Deliverable:** `agents/delivery/src/state.ts` `finishPhaseStmt` SQL updated from `WHERE issue_key = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1` to `WHERE issue_key = ? AND phase = ? AND finished_at IS NULL`; `finishPhase()` passes `phase` as the second bind parameter; the `void phase` comment is removed; a unit test covering the two-phase replay scenario confirms the correct row is updated.
  - **Acceptance (EARS):**
    - WHEN `finishPhase(issueKey, phase, result)` is called, THE SYSTEM SHALL update the `phases` row matching both `issue_key = issueKey` AND `phase = phase` with `finished_at IS NULL`.
    - WHEN two phases for the same `issueKey` are simultaneously in-flight, THE SYSTEM SHALL update the correct phase row as specified by the `phase` argument.
    - THE SYSTEM SHALL NOT silently discard the `phase` argument.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: finishPhase updates the correct row
      Given phases rows for issueKey "CREW-50" with phase "implement" (unfinished) and phase "peer-review" (unfinished)
      When finishPhase("CREW-50", "peer-review", { verdict: "approved" }) is called
      Then the "peer-review" phases row has finished_at set
      And the "implement" phases row still has finished_at null

    Scenario: phase argument is not discarded
      Given a finishPhase call with phase "implement"
      When the UPDATE statement executes
      Then the WHERE clause includes phase = "implement"
    ```

---

- [ ] **[CREW-53-003] Add idempotency guard to `createMr()`**
  - **Status:** Not started | **Priority:** P1 | **Estimate:** 3
  - **Epic:** CREW-53 | **Labels:** review:#10, type:correctness
  - **Depends on:** —
  - **Deliverable:** `agents/delivery/src/integrations/gitlab.ts` `createMr()` calls `GET /merge_requests?source_branch=<branchName>&state=opened` before `POST /merge_requests`; if an open MR for that branch already exists, the function returns the existing MR's `web_url` without posting a new MR; if no existing MR is found, the function proceeds with `POST /merge_requests` as before; unit tests for the existing-MR path and the no-existing-MR path.
  - **Acceptance (EARS):**
    - WHEN `createMr()` is called and an open merge request already exists for `branchName`, THE SYSTEM SHALL return the existing MR's `web_url` without issuing a `POST /merge_requests` request.
    - WHEN `createMr()` is called and no open merge request exists for `branchName`, THE SYSTEM SHALL proceed with `POST /merge_requests` and return the new MR's `web_url`.
    - WHEN the `GET /merge_requests` lookup fails, THE SYSTEM SHALL propagate the error to the caller rather than silently creating a duplicate MR.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Existing MR is returned without duplicate POST
      Given an open MR exists for branch "feat/CREW-50-sdk"
      When createMr() is called with branchName "feat/CREW-50-sdk"
      Then GET /merge_requests?source_branch=feat/CREW-50-sdk is called
      And no POST /merge_requests request is issued
      And the existing MR's web_url is returned

    Scenario: No existing MR -- new MR is created
      Given no open MR exists for branch "feat/CREW-50-sdk"
      When createMr() is called with branchName "feat/CREW-50-sdk"
      Then GET /merge_requests?source_branch=feat/CREW-50-sdk returns an empty list
      And POST /merge_requests is issued
      And the new MR's web_url is returned

    Scenario: GET lookup failure propagates as error
      Given the GitLab API returns 500 for the GET /merge_requests lookup
      When createMr() is called
      Then the error is propagated to the caller
      And no POST /merge_requests is issued
    ```

---

### CREW-54 -- Code quality and hygiene

**Scope.** Five low-effort fixes that remove confusion, dead code, and maintenance surface area. These do not affect runtime behaviour but materially improve the contributor experience and reduce the chance of future bugs.

**Key deliverables.** `AGENTS.md` with `@daddia/*` package names; test mocks without `db: {} as never`; unused tooling configs and esbuild entry deleted; `.claude/settings.json` `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` documented; `extractMrIid()` validates the project path.

**Dependencies.** None.

**Status.** Not started.

---

- [x] **[CREW-54-001] Fix AGENTS.md package names**
  - **Status:** Done | **Priority:** P2 | **Estimate:** 1
  - **Epic:** CREW-54 | **Labels:** review:#11, type:docs
  - **Depends on:** —
  - **Deliverable:** `AGENTS.md` updated throughout to replace `@org/*` placeholders with the actual package names: `@daddia/crew`, `@daddia/crew/webhooks`, `@daddia/agent-delivery`, `@daddia/agent-code-reviewer`; no instance of the `@org/` prefix remains in `AGENTS.md`. (Superseded in part by CREW-56 consolidation; current docs use the single shared library and subpath.)
  - **Acceptance (EARS):**
    - WHEN `AGENTS.md` is read, THE SYSTEM SHALL reference all packages under the `@daddia/` scope, not `@org/`.
    - THE SYSTEM SHALL NOT contain any `@org/` package reference in `AGENTS.md`.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: No @org/ references in AGENTS.md
      Given AGENTS.md is read
      When it is searched for the string "@org/"
      Then no matches are found

    Scenario: @daddia/ scope is used throughout
      Given AGENTS.md is read
      When shared library and agent package names are inspected
      Then the shared library is documented as @daddia/crew and @daddia/crew/webhooks
      And agent units are documented as @daddia/agent-delivery and @daddia/agent-code-reviewer
    ```

---

- [ ] **[CREW-54-002] Remove spurious `db` property from test mock helpers**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 1
  - **Epic:** CREW-54 | **Labels:** review:#13, type:test
  - **Depends on:** —
  - **Deliverable:** `agents/delivery/tests/workflow.test.ts` and `agents/delivery/tests/handlers.jira.test.ts` `makeState()` helpers have `db: {} as never` removed; `pnpm typecheck` passes with no excess-property errors on the state mock literal; if the production `StateStore` interface is later extended to include `db`, it is added to the interface first.
  - **Acceptance (EARS):**
    - WHEN `makeState()` is called in the test helpers, THE SYSTEM SHALL return an object whose properties are a subset of the `StateStore` interface with no excess properties.
    - WHEN `pnpm typecheck` runs, THE SYSTEM SHALL report zero TypeScript errors related to `db` in the test mock objects.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: makeState() has no excess db property
      Given workflow.test.ts and handlers.jira.test.ts
      When makeState() objects are inspected
      Then neither contains a "db" property

    Scenario: pnpm typecheck passes after removal
      Given db: {} as never is removed from both test files
      When pnpm typecheck runs
      Then no TypeScript errors related to the mock objects are reported
    ```

---

- [N/A] **[CREW-54-003] Delete unused tooling configs and esbuild entry**
  - **Status:** N/A | **Priority:** P2 | **Estimate:** 2
  - **Epic:** CREW-54 | **Labels:** review:#14, review:#15, type:hygiene
  - **Depends on:** —

---

- [N/A] **[CREW-54-004] Document or remove `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` setting**
  - **Status:** Done | **Priority:** P2 | **Estimate:** 1
  - **Epic:** CREW-54 | **Labels:** review:#16, type:docs
  - **Depends on:** —

---

- [ ] **[CREW-54-005] Fix `extractMrIid()` URL validation**
  - **Status:** Not started | **Priority:** P2 | **Estimate:** 2
  - **Epic:** CREW-54 | **Labels:** review:#18, type:correctness
  - **Depends on:** —
  - **Deliverable:** `agents/delivery/src/integrations/gitlab.ts` `extractMrIid()` validates that the extracted project path (from the URL) matches `GITLAB_PROJECT_ID` before returning the IID; if there is a mismatch, the function throws a typed error rather than silently returning a wrong IID; alternatively, the IID is typed and passed as a field on the MR object rather than re-extracted from the URL.
  - **Acceptance (EARS):**
    - WHEN `extractMrIid()` is called with a URL whose project path does not match `GITLAB_PROJECT_ID`, THE SYSTEM SHALL throw a typed error rather than returning an IID from the wrong project.
    - WHEN `extractMrIid()` is called with a valid URL matching `GITLAB_PROJECT_ID`, THE SYSTEM SHALL return the correct numeric IID.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: URL from correct project returns IID
      Given GITLAB_PROJECT_ID is "daddia/crew"
      And a webUrl of "https://gitlab.com/daddia/crew/-/merge_requests/42"
      When extractMrIid(webUrl) is called
      Then 42 is returned

    Scenario: URL from wrong project throws
      Given GITLAB_PROJECT_ID is "daddia/crew"
      And a webUrl of "https://gitlab.com/other-org/other-repo/-/merge_requests/42"
      When extractMrIid(webUrl) is called
      Then a typed error is thrown indicating project path mismatch
    ```

---

### CREW-55 -- Observability and hardening

**Scope.** Six enhancements that make the running system easier to debug and more resilient under load. None are blockers for initial operation but all are important before the system runs unattended against real workloads.

**Key deliverables.** OpenTelemetry trace spans per phase and agent invocation; per-issueKey rate limiter middleware on webhook endpoints; per-agent `.env.example` files; workflow loop bound clarification comment; diff size and file-count cap in `getMrDiff()`; Turbo remote cache configured.

**Dependencies.** CREW-50 (tracing and rate limiter are most useful once agents actually run). CREW-52-001 (env examples require the canonical env var list to be known).

**Status.** Not started.

---

- [ ] **[CREW-55-001] Add OpenTelemetry trace spans per phase and agent invocation**
  - **Status:** Not started | **Priority:** P3 | **Estimate:** 5
  - **Epic:** CREW-55 | **Labels:** review:#19, type:observability
  - **Depends on:** CREW-50-001
  - **Deliverable:** `agents/delivery/src/observability.ts` bootstraps an OTLP trace exporter (configurable via `OTEL_EXPORTER_OTLP_ENDPOINT`); `workflow.ts` wraps each phase execution in a trace span named `crew.phase.<phaseName>` with attributes `issueKey`, `phase`, and `sessionId`; each `agent.run()` call is wrapped in a child span named `crew.agent.<personaName>` with attributes `persona`, `issueKey`; `phaseRow.sessionId` is used as the correlation field linking the phase span to the agent span; spans are exported even when OTLP endpoint is absent (no-op exporter used as fallback).
  - **Acceptance (EARS):**
    - WHEN a workflow phase executes, THE SYSTEM SHALL emit an OpenTelemetry span named `crew.phase.<phaseName>` with `issueKey` and `phase` attributes.
    - WHEN an agent `run()` executes within a phase, THE SYSTEM SHALL emit a child span named `crew.agent.<personaName>` with `persona` and `issueKey` attributes.
    - WHEN `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, THE SYSTEM SHALL use a no-op exporter and SHALL NOT throw an error.
    - WHEN `OTEL_EXPORTER_OTLP_ENDPOINT` is set, THE SYSTEM SHALL export spans to that endpoint.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Phase span is emitted
      Given a workflow executing the "implement" phase for issueKey "CREW-50-001"
      When the phase completes
      Then a span named "crew.phase.implement" is recorded
      And the span has attribute issueKey "CREW-50-001"

    Scenario: Agent child span is emitted
      Given an agent.run() call inside the "implement" phase
      When the run completes
      Then a child span named "crew.agent.engineer" is recorded under the phase span

    Scenario: Missing OTLP endpoint uses no-op exporter
      Given OTEL_EXPORTER_OTLP_ENDPOINT is not set
      When the delivery agent starts and a workflow executes
      Then no error is thrown related to the missing OTLP endpoint
    ```

---

- [ ] **[CREW-55-002] Add per-issueKey rate limiting on webhook endpoints**
  - **Status:** Not started | **Priority:** P3 | **Estimate:** 3
  - **Epic:** CREW-55 | **Labels:** review:#20, type:reliability
  - **Depends on:** —
  - **Deliverable:** Hono middleware added to both `/webhooks/jira` and `/webhooks/gitlab` routes that limits concurrent workflow runs for the same `issueKey` to 1; subsequent webhook events for an already-in-flight `issueKey` return `HTTP 429` with a structured body `{ error: "workflow-in-flight", issueKey }`; the rate limiter uses an in-memory map keyed on `issueKey`; the limit is configurable via `WORKFLOW_CONCURRENCY_PER_ISSUE` env var (default `1`).
  - **Acceptance (EARS):**
    - WHEN a webhook event arrives for an `issueKey` that already has an in-flight workflow, THE SYSTEM SHALL return HTTP 429 with body `{ error: "workflow-in-flight", issueKey }`.
    - WHEN a webhook event arrives for an `issueKey` with no in-flight workflow, THE SYSTEM SHALL process the event normally.
    - THE SYSTEM SHALL release the in-flight lock for an `issueKey` when its workflow completes or fails.
    - THE SYSTEM SHALL read the `WORKFLOW_CONCURRENCY_PER_ISSUE` env var as the per-key limit (default 1).
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Duplicate webhook for in-flight story is rate limited
      Given a workflow is in flight for issueKey "CREW-50-001"
      When a second webhook event arrives for the same issueKey
      Then HTTP 429 is returned with body { error: "workflow-in-flight", issueKey: "CREW-50-001" }

    Scenario: Webhook for idle story is processed normally
      Given no workflow is in flight for issueKey "CREW-50-002"
      When a webhook event arrives for "CREW-50-002"
      Then the event is processed and HTTP 200 is returned

    Scenario: Lock is released after workflow completion
      Given a workflow for issueKey "CREW-50-001" completes
      When a new webhook event arrives for "CREW-50-001"
      Then HTTP 200 is returned and the workflow starts
    ```

---

- [ ] **[CREW-55-003] Add per-agent `.env.example` files**
  - **Status:** Not started | **Priority:** P3 | **Estimate:** 1
  - **Epic:** CREW-55 | **Labels:** review:#21, type:docs
  - **Depends on:** CREW-52-001
  - **Deliverable:** `agents/delivery/.env.example` documents every required env var (`ANTHROPIC_API_KEY`, `ATLASSIAN_BASE_URL`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `GITLAB_PERSONAL_ACCESS_TOKEN`, `JIRA_WEBHOOK_SECRET`, `GITLAB_WEBHOOK_SECRET`, `DB_PATH`) and optional env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `WORKFLOW_CONCURRENCY_PER_ISSUE`, `REFACTOR_LOOP_CAP`) with a one-line description for each; `agents/code-reviewer/.env.example` documents its own required and optional vars; the root `.env.example` is updated to cross-reference the per-agent files.
  - **Acceptance (EARS):**
    - WHEN `agents/delivery/.env.example` is read, THE SYSTEM SHALL document every required env var identified in CREW-52-001, each with a non-empty description.
    - WHEN `agents/code-reviewer/.env.example` is read, THE SYSTEM SHALL document every required and optional env var for that agent.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Delivery agent env example documents all required vars
      Given agents/delivery/.env.example
      When it is read
      Then ANTHROPIC_API_KEY, ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN,
           GITLAB_PERSONAL_ACCESS_TOKEN, JIRA_WEBHOOK_SECRET, GITLAB_WEBHOOK_SECRET, and DB_PATH
           are all present with descriptions

    Scenario: Code reviewer env example exists
      Given agents/code-reviewer/.env.example
      When it is read
      Then it documents at least the ANTHROPIC_API_KEY and any agent-specific required vars
    ```

---

- [ ] **[CREW-55-004] Clarify workflow loop bound semantics**
  - **Status:** Not started | **Priority:** P3 | **Estimate:** 1
  - **Epic:** CREW-55 | **Labels:** review:#23, type:docs
  - **Depends on:** —
  - **Deliverable:** `agents/delivery/src/workflow.ts` loop at line 55 has a code comment explaining the asymmetry: with `REFACTOR_LOOP_CAP=2` the loop runs `cap + 1` peer-review calls (iterations 0, 1, 2) but only `cap` address-feedback calls (the `if (iteration >= REFACTOR_LOOP_CAP) break` check prevents the third address-feedback call); `AGENTS.md` updated to reflect this semantic precisely.
  - **Acceptance (EARS):**
    - WHEN `workflow.ts` is read, THE SYSTEM SHALL contain a comment at the loop bound explaining the cap + 1 senior-engineer call count versus the cap address-feedback call count.
    - WHEN `AGENTS.md` documents the loop cap, THE SYSTEM SHALL accurately state the asymmetry between peer-review and address-feedback call counts.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Loop bound comment explains asymmetry
      Given workflow.ts at the peer-review loop
      When the code comment near the loop bound is read
      Then it explains that REFACTOR_LOOP_CAP=N allows N+1 senior-engineer calls and N address-feedback calls
    ```

---

- [ ] **[CREW-55-005] Add diff size and file-count cap to `getMrDiff()`**
  - **Status:** Not started | **Priority:** P3 | **Estimate:** 3
  - **Epic:** CREW-55 | **Labels:** review:#25, type:reliability
  - **Depends on:** CREW-50-001
  - **Deliverable:** `agents/delivery/src/integrations/gitlab.ts` `getMrDiff()` adds a file-count cap (`DIFF_FILE_CAP`, default 50) and a total diff-size cap in bytes (`DIFF_SIZE_CAP_BYTES`, default 500 000); when the response exceeds the file cap, only the first `DIFF_FILE_CAP` files are included and a note is appended to the returned diff string; when the byte cap is exceeded, the diff is truncated and a note is appended; both caps are configurable via env vars.
  - **Acceptance (EARS):**
    - WHEN `getMrDiff()` returns more than `DIFF_FILE_CAP` files, THE SYSTEM SHALL truncate to the first `DIFF_FILE_CAP` files and append a note indicating how many files were omitted.
    - WHEN the total diff size exceeds `DIFF_SIZE_CAP_BYTES`, THE SYSTEM SHALL truncate the diff and append a note indicating truncation.
    - WHEN the diff is within both caps, THE SYSTEM SHALL return the full diff without modification.
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

- [ ] **[CREW-55-006] Configure Turbo remote cache**
  - **Status:** Not started | **Priority:** P3 | **Estimate:** 2
  - **Epic:** CREW-55 | **Labels:** review:#24, type:infrastructure
  - **Depends on:** CREW-51-002
  - **Deliverable:** `turbo.json` updated with a `remoteCache` configuration (Vercel, Turborepo Cloud, or self-hosted); CI workflow from CREW-51-002 passes `TURBO_TOKEN` and `TURBO_TEAM` (or equivalent) as secrets; cache hit/miss is logged in CI output; remote cache is optional — if credentials are absent the build falls back to local cache without error.
  - **Acceptance (EARS):**
    - WHEN `TURBO_TOKEN` and `TURBO_TEAM` env vars are set, THE SYSTEM SHALL use the configured remote cache for Turbo build artifacts.
    - WHEN `TURBO_TOKEN` is absent, THE SYSTEM SHALL fall back to local cache without error.
    - WHEN a CI run hits the remote cache for unchanged packages, THE SYSTEM SHALL skip rebuilding those packages.
  - **Acceptance (Gherkin):**

    ```gherkin
    Scenario: Remote cache is used when credentials are present
      Given TURBO_TOKEN and TURBO_TEAM are set in CI
      And packages/crew was built in a prior run
      When a subsequent CI run builds with no changes to that package
      Then Turbo reports a cache hit for packages/crew
      And the build completes faster than a cold build

    Scenario: Missing credentials fall back to local cache
      Given TURBO_TOKEN is not set
      When pnpm build runs
      Then the build completes without error using the local cache
    ```

---

## 5. Dependency graph

```text
CREW-50 (SDK wire-up)
  +-- CREW-50-001 (resolveSession -- unstable_v2_createSession / resumeSession)
        +-- CREW-50-002 (engineer run + memory: 'project')
              +-- CREW-50-007 (seed initial project memory)
        +-- CREW-50-003 (senior-engineer run + memory: 'project')
        +-- CREW-50-004 (tech-lead run + memory: 'project')
        +-- CREW-50-005 (code-quality run + memory: 'project')
        +-- CREW-50-006 (subagentPaths)
              +-- CREW-55-001 (OTel tracing -- most useful once runs are live)
              +-- CREW-55-005 (getMrDiff cap -- most useful once reviews run)

CREW-51 (container, CI, deploy hygiene)
  +-- CREW-51-001 (Dockerfile corepack)  [no deps]
  +-- CREW-51-002 (CI pipeline)           [no deps]
        +-- CREW-55-006 (Turbo remote cache)
  +-- CREW-51-003 (Dockerfile lockfile)   [no deps]

CREW-52 (startup reliability)
  +-- CREW-52-001 (env validation)        [no deps]
        +-- CREW-52-002 (auth header)     [after CREW-52-001]
        +-- CREW-55-003 (env examples)    [after CREW-52-001]
  +-- CREW-52-003 (crash recovery -- unstable_v2_resumeSession) [CREW-50-001 required]
  +-- CREW-52-004 (MCP pin)              [no deps]

CREW-53 (state integrity)
  +-- CREW-53-001 (SQLite consolidation) [no deps]
  +-- CREW-53-002 (finishPhase fix)      [no deps]
  +-- CREW-53-003 (createMr idempotency) [no deps]

CREW-54 (code quality)                   [no blocking deps on any other epic]

CREW-55 (observability and hardening)
  +-- CREW-55-002 (rate limiting -- in-memory Map) [no deps]
  +-- CREW-55-004 (loop bound comment)   [no deps]
```

## 6. Critical path

```text
CREW-50-001 (resolveSession -- unstable_v2_createSession / resumeSession)
  --> CREW-50-002/003/004/005 (four persona run() methods + memory: 'project')
        --> CREW-50-007 (seed initial project memory -- after CREW-50-002)
        --> system is operational (agents execute with persistent memory)
              --> CREW-52-003 (crash recovery via unstable_v2_resumeSession -- required now)
              --> CREW-55-001 (OTel tracing -- meaningful once runs are live)
              --> CREW-55-005 (diff cap -- meaningful once reviews run)

CREW-51-001 (Dockerfile)  -- unblocked; critical for container builds
CREW-51-002 (CI)          -- unblocked; critical safety net
CREW-52-001 (env valid.)  -- unblocked; blocks CREW-52-002
CREW-53-002 (finishPhase) -- unblocked; correctness fix needed before load
CREW-53-003 (createMr)    -- unblocked; correctness fix needed before load
```

## 7. Parallelisation opportunities

| Workstream | Can run in parallel with |
| --- | --- |
| CREW-50-001 | CREW-51-001, CREW-51-002, CREW-51-003, CREW-52-001, CREW-52-004, CREW-53-001, CREW-53-002, CREW-53-003, all of CREW-54 |
| CREW-50-002..007 | Each other (after CREW-50-001); CREW-51, CREW-52, CREW-53, CREW-54 |
| CREW-50-007 | After CREW-50-002 only; everything else in parallel |
| CREW-51-001 | Everything |
| CREW-51-002 | Everything |
| CREW-53-001 | CREW-53-002, CREW-53-003 |
| CREW-54-001..005 | Everything (docs and hygiene only) |
| CREW-55-002..004, CREW-55-006 | Everything except CREW-55-001 and CREW-55-005 |

**Sprint 1 start.** CREW-50-001 (resolveSession) is the highest-value item to start first. Simultaneously: CREW-51-001 (Dockerfile, 1pt), CREW-51-002 (CI, 3pt), CREW-52-001 (env validation, 1pt), CREW-52-004 (MCP pin, 1pt), CREW-53-002 (finishPhase, 1pt), CREW-53-003 (createMr idempotency, 3pt), and all of CREW-54 can proceed in parallel.

## 8. Minimum viable slice

If scope pressure forces a cut, the smallest coherent slice that makes the system production-safe:

- **CREW-50-001** -- resolveSession (required before any agent executes)
- **CREW-50-002** -- engineer run() (the default implementation persona)
- **CREW-51-001** -- Dockerfile corepack fix (required for container builds)
- **CREW-51-002** -- CI pipeline (required before accepting contributions)
- **CREW-52-001** -- env validation (prevents silent misconfiguration)
- **CREW-53-002** -- finishPhase fix (correctness; cheap)
- **CREW-53-003** -- createMr idempotency (prevents duplicate MRs on replay)

Result: the engineer persona executes, containers build, CI is active, startup fails loudly on misconfiguration, and the most critical data integrity bugs are fixed. senior-engineer, tech-lead, code-quality run() implementations (CREW-50-003..005), crash recovery, subagentPaths, and all P2/P3 work follow in subsequent sprints.

## 9. Assumptions

| ID | Assumption | Impact if wrong |
| --- | --- | --- |
| A1 | The `@anthropic-ai/claude-code` SDK exposes `unstable_v2_createSession()` and `unstable_v2_resumeSession()` as the programmatic session API; the `memory: 'project'` field on `AgentDefinition` activates the persistent memory directory and injects tools automatically | If these APIs change or are removed before stable release, CREW-50-001 and CREW-50-002..007 require rework; spike against the installed SDK version before committing to the session contract |
| A2 | Pinning MCP server versions to currently-installed versions does not require immediate version discovery work | CREW-52-004 requires a short audit of current installed versions before writing the pinned strings |
| A3 | The Railway container's SQLite file survives a restart (persistent volume mounted at `DB_PATH`) | Without persistence, crash recovery (CREW-52-003) is moot; the volume assumption is documented in CREW-38 |
| A4 | OpenTelemetry Node.js SDK is available as a devDependency or can be added without violating dependency-cruiser rules | CREW-55-001 adds `@opentelemetry/sdk-node` and `@opentelemetry/exporter-trace-otlp-http`; dependency-cruiser config may need updating for agent-scoped instrumentation |

## 10. Risks (delivery-scoped)

Technical and architecture-scoped risks are tracked in `AGENTS.md` and the relevant integration modules. This register covers delivery risks only.

| ID | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | `@anthropic-ai/claude-code` SDK programmatic API surface is undocumented or unstable | Medium | High | Spike CREW-50-001 first; if the API surface is unclear, raise with Anthropic SDK team before committing to the session resumption contract |
| R2 | Crash recovery (CREW-52-003) introduces duplicate workflow runs if the phase completed but DB write failed | Medium | Medium | Check `started_at`/`finished_at` atomically; use SQLite's serialised WAL write for the phase state transition |
| R3 | MCP server version pinning (CREW-52-004) pins to a buggy version and requires an emergency unpin before the workflow is reliable | Low | Medium | Pin to the most recently tested version; document the version in the PR; add a note to the release runbook for future bumps |
| R4 | CREW-54-003 (tooling deletion) breaks a devDependency import in a currently-working config file not visible from static search | Low | Low | Run `pnpm build` and `pnpm typecheck` before merging; check `package.json` devDependencies for any reference to the deleted packages |

## 11. Definition of Done

A story in this backlog is done when:

- [ ] All EARS acceptance statements hold and every Gherkin scenario passes.
- [ ] `pnpm typecheck` passes with zero new `any` or excess-property errors.
- [ ] `pnpm lint` passes with no new dependency-cruiser violations.
- [ ] `pnpm test` passes with no new failures; new behaviour has >= 80% branch coverage.
- [ ] PR description links to this backlog and the review issue number(s) in the `Labels` field.
- [ ] Code review approved; all feedback addressed or tracked.
- [ ] PR merged to `main`.
- [ ] Changeset added with correct bump type for any changed published packages.
- [ ] `AGENTS.md` updated if the repo's public surface or conventions changed.

## 12. Handoff

When CREW-50 through CREW-53 close:

- All four persona `run()` methods are implemented and the system executes agents end-to-end.
- The container builds correctly with pnpm 10.
- CI protects every PR with lint, typecheck, and test gates.
- The server exits loudly on startup if required env vars are absent.
- Interrupted workflow phases are recovered on restart.
- MCP server versions are stable across deployments.
- The SQLite layer has a single connection and correct phase finalisation logic.
- Duplicate MR creation on workflow replay is prevented.

CREW-54 (code quality) and CREW-55 (observability and hardening) can follow in parallel once the system is operational. The Next-phase epics from the product backlog (`product/crew/backlog.md`) open once the Now-phase loop runs end-to-end on at least three merged stories.

---

## 13. Future backlog

Items below are not required for Crew to be operational. They are captured here for sequencing when the current backlog closes.

### F-01 -- Shared team memory across personas

**Context.** Each persona currently has its own `memory: 'project'` directory. Project-level knowledge that should be shared across all three personas — recurring review findings, architectural constraints the tech lead consistently enforces, patterns the senior engineer flags — lives in separate directories and does not cross over.

**Scope.** Configure all three delivery crew personas to read from a shared project memory directory in addition to their own. The Claude Code SDK supports a `memory: 'project'` scope that maps to a directory under the project root (`.claude/agent-memory/`). Extending this to a shared read path means the engineer can see what the tech lead has noted about quality standards, and the senior engineer can see what architectural patterns the tech lead has flagged, without any direct inter-persona communication.

**Dependencies.** CREW-50-007 (individual memory seeding must be stable first).

**Priority.** Post-operational. Opens after three stories complete end-to-end.

---

### F-02 -- Product doc: carry forward v1 gaps

**Context.** The current `docs/product/product.md` was written fresh for v2. Six elements from the v1 product strategy were identified as worth carrying forward: a rabbit hole on persona coordination through artifacts and state (not message passing); a no-go on direct inter-persona communication; a required maturity paragraph in target users; the adoption hypothesis framing in outcome metrics; two product principles (artifacts as working memory, personas as configuration); and a long-term thesis section on compounding value.

**Scope.** Six targeted additions to `docs/product/product.md` as detailed in the plan at `.cursor/plans/carry_forward_v1_gaps_490b14c2.plan.md`.

**Dependencies.** None.

**Priority.** Non-blocking documentation. Can be executed at any time.

---

### F-03 -- In-memory concurrency state (note for CREW-55-002)

**Context.** CREW-55-002 specifies an in-memory rate limiter keyed on `issueKey`. The deliverable calls for an in-memory map. When that story is worked, the implementation should use a plain `Map<string, boolean>` (or `Map<string, AbortController>`) rather than any third-party state management library. No React-oriented state management is appropriate in a Node.js server context. The map is intentionally ephemeral — if the process restarts, in-flight locks are released and crash recovery (CREW-52-003) handles re-queuing.

**Dependencies.** Addresses CREW-55-002 implementation detail.

**Priority.** Captured as a note; no separate story needed.
