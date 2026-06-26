---
type: Runbook
version: '0.1'
status: Active
last_updated: 2026-06-26
related:
  - crews/delivery-qa/src/config.ts
  - docs/design/crew-flows/delivery-qa.md
  - docs/runbook/delivery-build.md
  - docs/runbook/container.md
  - docs/architecture/security-model.md
---

# Operations Runbook — `delivery-qa`

The `delivery-qa` crew picks up Jira stories in **In QA**, validates the CI-green MR
in a sandbox QA workspace, runs a bounded defect/remediation loop with
`delivery-build`, and transitions passing stories to **In Review**. The canonical flow
contract: [`docs/design/crew-flows/delivery-qa.md`](../design/crew-flows/delivery-qa.md).
Env var schema (authoritative): [`crews/delivery-qa/src/config.ts`](../../crews/delivery-qa/src/config.ts).

---

## 1. Pre-deploy checklist

Before every deploy or configuration change, run `pnpm diagnose` against the target
environment to confirm all eight integration checks pass.

### 1.1 Set environment variables in the shell

Export the same variables that will be injected into the Railway service (see
[§2.2 Environment variables](#22-environment-variables) for the full table):

```sh
export ANTHROPIC_API_KEY=...
export ATLASSIAN_EMAIL=...
export ATLASSIAN_API_TOKEN=...
export ATLASSIAN_BASE_URL=https://yourorg.atlassian.net
export JIRA_PROJECT_KEY=...
export JIRA_ASSIGNEE_ACCOUNT_ID=...          # QA bot account ID
export JIRA_ACCEPTANCE_CRITERIA_FIELD_ID=customfield_10042
export GITLAB_PERSONAL_ACCESS_TOKEN=...
export GITLAB_API_URL=https://gitlab.com/api/v4
export GITLAB_PROJECT_ID=...
export JIRA_WEBHOOK_SECRET=...
export DB_PATH=/tmp/delivery-qa-preflight.db
export PROJECT_DIR=/workspace
export QA_WORKSPACE_DIR=/workspace/qa
export AUTOMATED_TEST_COMMAND="pnpm test"
```

### 1.2 Run the diagnostics

From the repo root, build the crew and run the diagnostics script:

```sh
pnpm build
cd crews/delivery-qa
pnpm diagnose
```

Expected output when all checks pass:

```text
✓ Jira API reachability: https://yourorg.atlassian.net is reachable
✓ Jira project key: project CREW exists
✓ Jira transitions: all four required transitions present
✓ GitLab API reachability: https://gitlab.com/api/v4 is reachable
✓ QA workspace: /workspace/qa
✓ Automated test command: pnpm test (executable: /usr/local/bin/pnpm)
✓ MCP servers boot: all 2 MCP server(s) responded to initialize
✓ DB_PATH directory writable: /tmp

All 8 checks passed.
```

`pnpm diagnose` exits with code `0` when all checks pass and code `1` when any
check fails. Do not deploy while any check is failing.

### 1.3 Diagnosing failures

| Check                      | Failure detail                        | Likely fix                                                                        |
| -------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| Jira API reachability      | `HTTP 401`                            | Verify `ATLASSIAN_API_TOKEN` and `ATLASSIAN_EMAIL`                                |
| Jira API reachability      | `HTTP 403` or DNS error               | Confirm `ATLASSIAN_BASE_URL` is correct and reachable                             |
| Jira project key           | `HTTP 404`                            | Confirm `JIRA_PROJECT_KEY` matches the board key                                  |
| Jira transitions           | `missing transitions: ...`            | Add the missing transitions in the Jira board workflow editor                     |
| GitLab API reachability    | `HTTP 401`                            | Confirm `GITLAB_PERSONAL_ACCESS_TOKEN` has `api` scope                            |
| GitLab API reachability    | `HTTP 404`                            | Confirm `GITLAB_PROJECT_ID` is the numeric ID, not the path                       |
| QA workspace               | `... is not accessible`               | Create `QA_WORKSPACE_DIR`; ensure the process user can read/write                 |
| Automated test command     | `executable not found`                | Install the test runner in the container image or adjust `AUTOMATED_TEST_COMMAND` |
| MCP servers boot           | `timed out waiting for MCP handshake` | Ensure `npx` is on PATH; check `ATLASSIAN_*` and `GITLAB_*` values                |
| DB_PATH directory writable | `... is not writable`                 | Confirm the parent directory exists and is writable                               |

The four required Jira transitions are: `In QA`, `In Review`, `In Remediation`,
`Needs human review`. If any are missing, add them in the Jira board project
settings under "Workflows".

---

## 2. Deploy

Deployment uses Railway. The Dockerfile copies from `packages/` and `tooling/`,
so the Docker build context must be the **repository root**.

### 2.1 Railway service configuration

| Dashboard field | Value                                   |
| --------------- | --------------------------------------- |
| Root Directory  | _(leave blank — defaults to repo root)_ |
| Dockerfile Path | `crews/delivery-qa/Dockerfile`          |

Set `PORT=3001` (default in the image) and mount a persistent volume for SQLite
state — see [§2.3 Persistent volume](#23-persistent-volume).

### 2.2 Environment variables

Canonical schema: [`crews/delivery-qa/src/config.ts`](../../crews/delivery-qa/src/config.ts).

#### Required

| Variable                            | Description                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                 | Anthropic API key for `qa-engineer` agent runs                                                       |
| `ATLASSIAN_EMAIL`                   | Atlassian account email for Jira API auth                                                            |
| `ATLASSIAN_API_TOKEN`               | Atlassian API token                                                                                  |
| `ATLASSIAN_BASE_URL`                | Jira base URL (e.g. `https://yourorg.atlassian.net`)                                                 |
| `JIRA_PROJECT_KEY`                  | Jira project key (e.g. `CREW`)                                                                       |
| `JIRA_ASSIGNEE_ACCOUNT_ID`          | Jira account ID of the **QA bot** — poller JQL filters on this assignee                              |
| `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID` | Custom field ID for acceptance criteria (e.g. `customfield_10042`)                                   |
| `GITLAB_PERSONAL_ACCESS_TOKEN`      | GitLab PAT with `api` scope                                                                          |
| `GITLAB_API_URL`                    | GitLab API base (e.g. `https://gitlab.com/api/v4`)                                                   |
| `GITLAB_PROJECT_ID`                 | Numeric GitLab project ID                                                                            |
| `JIRA_WEBHOOK_SECRET`               | Shared secret for Jira webhook HMAC verification (≥ 16 characters)                                   |
| `DB_PATH`                           | SQLite file path (e.g. `/data/delivery-qa.db` in production)                                         |
| `PROJECT_DIR`                       | Absolute path to the target repository root on the container filesystem                              |
| `QA_WORKSPACE_DIR`                  | Isolated checkout directory for QA runs — MR branch is checked out here before deploy and test steps |

#### Behaviour and cost controls

| Variable                    | Default       | Description                                                                                                                                                                                |
| --------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `QA_DEFECT_LOOP_CAP`        | `2`           | Maximum remediation cycles before escalation to **Needs human review**. A cap of `N` allows up to `N` round-trips through `In Remediation → In QA` before the next defect batch escalates. |
| `REMEDIATION_TIMEOUT_HOURS` | `48`          | Hours to wait in `remediation-pending` for `delivery-build` to fix defects and re-transition to **In QA**. Exceeded → automatic escalation.                                                |
| `POLL_INTERVAL_MS`          | `300000`      | Milliseconds between Jira polling ticks                                                                                                                                                    |
| `AUTOMATED_TEST_COMMAND`    | `pnpm test`   | Shell command run in `QA_WORKSPACE_DIR` during the automated-suite step                                                                                                                    |
| `E2E_TEST_COMMAND`          | _(unset)_     | Optional second test command (e.g. `pnpm test:e2e`) run after the automated command                                                                                                        |
| `QA_DEPLOY_SCRIPT`          | _(unset)_     | Optional path relative to `PROJECT_DIR` executed after MR checkout (sandbox deploy hook)                                                                                                   |
| `EXTERNAL_INTEGRATION_MODE` | `mock`        | `mock` logs skip and continues; `skip` omits the step; `live` is deferred — do not set `live` in production until configured                                                               |
| `QA_ENGINEER_MAX_TURNS`     | `40`          | Max agent turns per `qa-engineer` step                                                                                                                                                     |
| `QA_ENGINEER_COST_CAP_USD`  | `4`           | Per-step cost cap for `qa-engineer` runs                                                                                                                                                   |
| `LOG_LEVEL`                 | `info`        | Log verbosity (`debug`, `info`, `warn`, `error`)                                                                                                                                           |
| `PORT`                      | `3001`        | HTTP listen port                                                                                                                                                                           |
| `CREW_ID`                   | `delivery-qa` | Crew identifier in structured logs                                                                                                                                                         |
| `ATLASSIAN_ACCOUNT_ID`      | _(unset)_     | Bot account ID for webhook author filtering when needed                                                                                                                                    |
| `HONEYCOMB_API_KEY`         | _(unset)_     | Optional OTel export key                                                                                                                                                                   |

### 2.3 Persistent volume

Provision a Railway volume once after linking the service:

```sh
# One-time setup — run after `railway link` has associated the CLI with the service.
railway volume add --mount-path /data
railway variables set DB_PATH=/data/delivery-qa.db
```

Also ensure `QA_WORKSPACE_DIR` points at a writable path on the container
filesystem (e.g. `/workspace/qa`). The Dockerfile does not clone the target
repo — the deploy step checks out the MR branch at runtime. Mount or bake in
the target repository at `PROJECT_DIR` according to your hosting layout.

Without a persistent volume the SQLite state is wiped on every redeploy — the
crash-recovery scan becomes a no-op and story deduplication is lost.

### 2.4 Webhook registration

After the service is live, register the Railway public URL with Jira:

| Provider | URL                                      | Trigger                         |
| -------- | ---------------------------------------- | ------------------------------- |
| Jira     | `https://<railway-domain>/webhooks/jira` | Issue transitioned to **In QA** |

The poller is the fallback trigger when webhooks are delayed or missed.

### 2.5 Cross-crew prerequisites

`delivery-build` must be deployed and configured to:

- Transition stories to **In QA** after CI is green.
- Poll **In Remediation** with label `qa-remediation` and run the `fix-qa-defects`
  engineer task before re-transitioning to **In QA**.

See [`docs/runbook/delivery-build.md`](delivery-build.md) for the upstream crew.

---

## 3. Smoke test

Verify the service is alive after each deploy.

### 3.1 Health endpoint

```sh
curl -s https://<railway-domain>/healthz | jq .
```

Expected response:

```json
{ "ok": true }
```

The endpoint always returns HTTP 200 when the process is listening. For poller
and database health detail, use structured logs (`poller.tick`, `poller.search-error`)
and the SQLite `stories` / `steps` tables on the mounted volume.

### 3.2 Confirm the poller ticks

After the service starts, wait one poll interval (default: 5 minutes) and check
logs for `poller.tick`. If `poller.search-error` appears, verify `ATLASSIAN_*`
credentials and that `JIRA_ASSIGNEE_ACCOUNT_ID` is the QA bot account.

---

## 4. Monitoring

### 4.1 Log events to alert on

| Event                                        | Level | Meaning                                                           | Recommended action                                                                     |
| -------------------------------------------- | ----- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `workflow.escalate`                          | warn  | Story escalated to human review                                   | Check `reason`; review the Jira escalation comment                                     |
| `workflow.remediation-timeout`               | warn  | `REMEDIATION_TIMEOUT_HOURS` exceeded while waiting for build crew | Review ticket; coordinate with engineer or manually fix and re-transition to **In QA** |
| `poller.search-error`                        | warn  | Jira API unreachable during a poll tick                           | Verify `ATLASSIAN_*` credentials and Jira status                                       |
| `recovery.session-failed`                    | warn  | Boot-time crash recovery could not reconnect an SDK session       | Story escalated automatically; review the Jira ticket                                  |
| `workflow.qa.complete` with `success: false` | info  | Story reached a terminal step without landing in **In Review**    | Check `terminalStep`; `needs-human-review` or `remediation-pending`                    |
| `config.invalid`                             | error | Config schema validation failed at boot                           | Service will exit; fix the bad env var and redeploy                                    |
| `poller.misconfigured`                       | warn  | `JIRA_PROJECT_KEY` or `JIRA_ASSIGNEE_ACCOUNT_ID` is blank         | Fix Railway env; no stories will be picked up                                          |

### 4.2 Normal steady-state events

| Event                                       | Level | Meaning                                                                                  |
| ------------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `server.start`                              | info  | HTTP server is listening                                                                 |
| `config.loaded`                             | info  | Config validated and loaded at boot (secrets redacted)                                   |
| `workflow.qa.start`                         | info  | Story entered the QA workflow                                                            |
| `workflow.handoff-to-review`                | info  | Story passed QA; transitioned to **In Review** — downstream signal for `delivery-review` |
| `workflow.remediation-required`             | info  | Defects documented; story in **In Remediation** awaiting `delivery-build`                |
| `workflow.qa.remediation-resume`            | info  | Story returned from remediation; re-running validation                                   |
| `workflow.qa.complete` with `success: true` | info  | Story completed; `totalCostUsd` and `durationMs` available                               |

### 4.3 `workflow.qa.complete` payload

Emitted at terminal exit points (`in-review`, `needs-human-review`,
`remediation-pending`). Key fields:

| Field          | Type    | Notes                                                       |
| -------------- | ------- | ----------------------------------------------------------- |
| `issueKey`     | string  | Jira issue key                                              |
| `terminalStep` | string  | `in-review`, `needs-human-review`, or `remediation-pending` |
| `success`      | boolean | `true` only when `terminalStep` is `in-review`              |
| `totalCostUsd` | number  | Aggregate cost across all agent steps                       |
| `stepCount`    | number  | Total steps including non-agent steps                       |
| `agentSteps`   | array   | Per-agent-step: `{ step, sessionId, costUsd }`              |
| `durationMs`   | number  | Wall time from first step to terminal step                  |
| `mrUrl`        | string  | Present when an MR was resolved                             |

---

## 5. Escalation playbooks

Every failure branch transitions the Jira ticket to **Needs human review** with a
comment and logs `workflow.escalate` — the workflow never throws to the HTTP layer.

### 5.1 CI not green at QA start

**Cause:** At `context-seed`, the GitLab pipeline for the linked MR is not
`success`. QA must not run against a failing pipeline.

**Automatic action:** `escalateToHumanReview` with reason
`CI pipeline not green at QA start (status: <status>)`. Ticket moves to
**Needs human review**.

**Operator steps:**

1. Open the MR in GitLab; confirm pipeline status.
2. If the failure is transient, re-run the pipeline and wait for green.
3. Transition the Jira ticket back to **In QA** (or **To Do** → let
   `delivery-build` re-hand off) once CI is green.
4. If the failure is legitimate, assign to an engineer to fix before re-entering QA.

### 5.2 Defect loop cap reached

**Cause:** Product defects were found and remediated `QA_DEFECT_LOOP_CAP` times
without a clean pass. The `workflow.escalate` warn is logged with reason
`Defect loop cap reached`.

**Automatic action:** Jira comment listing unresolved defects → transition to
**Needs human review**.

**Operator steps:**

1. Review the structured defect comment on the Jira ticket and the MR diff.
2. Manually fix remaining issues or decide the story should not proceed.
3. To retry: clear the SQLite story row if needed, transition back to **In QA**.
4. If the cap is consistently too low, raise `QA_DEFECT_LOOP_CAP` in Railway env
   — see [§6.1](#61-qa_defect_loop_cap).

**Cap semantics:** With `QA_DEFECT_LOOP_CAP=N`, the crew allows `N` remediation
handoffs (`remediation-handoff` step occurrences) before the next defect batch
escalates. Default `2` means up to two full build-fix-re-QA cycles.

### 5.3 Remediation timeout

**Cause:** The story has been in local state `remediation-pending` longer than
`REMEDIATION_TIMEOUT_HOURS` without returning to **In QA**. The poller's
`watchRemediationTimeouts` fires on each tick.

**Automatic action:** `workflow.remediation-timeout` warn →
`escalateToHumanReview` with reason `Remediation timeout exceeded (Nh)`.

**Operator steps:**

1. Check whether `delivery-build` is running and polling **In Remediation** with
   label `qa-remediation`.
2. Review the Jira ticket — defect comment should list what needs fixing.
3. If engineering is blocked, unblock or manually fix the MR.
4. On fix: transition **In Remediation → In QA** (build crew does this on
   success) or manually transition and let the QA poller resume.
5. If `REMEDIATION_TIMEOUT_HOURS` is too aggressive for your team, raise it —
   see [§6.2](#62-remediation_timeout_hours).

### 5.4 Deploy / workspace infrastructure failure

**Cause:** MR checkout, `QA_DEPLOY_SCRIPT`, or test runner crash (OOM, missing
binary) before a product verdict can be determined.

**Automatic action:** Escalate with infra reason; defect loop is **not** entered.

**Operator steps:**

1. Verify `QA_WORKSPACE_DIR` is writable and large enough for a full checkout.
2. Confirm `AUTOMATED_TEST_COMMAND` executable exists in the container (`pnpm diagnose`).
3. If using `QA_DEPLOY_SCRIPT`, verify the script path relative to `PROJECT_DIR`.
4. Re-transition to **In QA** after fixing infrastructure.

### 5.5 Agent step failure

**Cause:** `qa-engineer` returns `success: false` at any agent step
(`deploy-qa`, `exploratory-pass`, `document-defects`).

**Automatic action:** Escalate at the current step.

**Operator steps:** Review agent session logs (if available), Jira comments, and
test output. Fix root cause and re-transition to **In QA**.

### 5.6 In-flight story on boot (crash recovery)

**Cause:** Process crashed mid-agent-run. The `steps` table has a row where
`session_id IS NOT NULL` and `finished_at IS NULL`.

**Automatic action:** `recoverInterruptedSteps` runs once at boot. Reconnects the
SDK session and restarts `runQaWorkflow`, or escalates on failure
(`recovery.session-failed`).

**Manual steps if auto-recovery escalates:**

1. Check `recovery.session-failed` for `issueKey` and `sessionId`.
2. Review the Jira escalation comment.
3. Clear the interrupted row if re-running from scratch:
   `DELETE FROM steps WHERE issue_key = '<ISSUE_KEY>' AND finished_at IS NULL;`
4. Transition the Jira issue back to **In QA**.

### 5.7 SQLite volume loss

Same recovery pattern as [`delivery-build.md` §5.4](delivery-build.md#54-sqlite-volume-loss).
Re-attach the volume, set `DB_PATH=/data/delivery-qa.db`, redeploy, and audit
in-flight Jira tickets.

---

## 6. Cost controls and tuning

### 6.1 `QA_DEFECT_LOOP_CAP`

Controls how many remediation round-trips are allowed before escalation. Default: `2`.

**Tuning:** Lower to `0` or `1` for strictly bounded QA cost on well-tested
stories. Raise to `3` only when defect-fix cycles are expected (complex features).
Each cycle adds one `document-defects` run, a full `delivery-build` fix path,
and a re-validation pass in QA.

### 6.2 `REMEDIATION_TIMEOUT_HOURS`

Hours the crew waits for `delivery-build` to fix defects and re-hand off. Default: `48`.

**Tuning:** Lower to `24` for time-sensitive delivery. Raise to `72` when
engineers are in different time zones. Does not affect agent cost — only idle
time before escalation.

### 6.3 `QA_ENGINEER_MAX_TURNS` and `QA_ENGINEER_COST_CAP_USD`

Per-step guardrails on `qa-engineer` agent runs. Defaults: `40` turns, `$4` USD.

**Tuning:** Lower cost cap if exploratory passes are running long. Check
`workflow.qa.complete` `agentSteps` breakdown to identify expensive steps.

### 6.4 Reading costs from logs

After each story completes, `workflow.qa.complete` includes `totalCostUsd`,
`durationMs`, and per-step `agentSteps`. Use these to baseline cost per story
type and calibrate caps.

---

## 7. Remediation loop — operator notes

The defect/remediation loop spans two crews. No shared SQLite or in-process
calls — coordination is via Jira state, labels, and structured log lines.

```text
delivery-qa                          delivery-build
───────────                          ──────────────
defects found
  → Jira comment (structured)
  → In QA → In Remediation
  → label qa-remediation
  → log workflow.remediation-required
  → state: remediation-pending
  → HITL pause ──────────────────►  poller: In Remediation + qa-remediation
                                      → engineer fix-qa-defects
                                      → CI check
                                      → In Remediation → In QA
                                      → log workflow.handoff-to-qa
  ◄───────────────────────────────
poller/webhook: In QA resumed
  → log workflow.qa.remediation-resume
  → re-run automated-suite (+ exploratory if needed)
  → pass → In Review
  → log workflow.handoff-to-review
```

**What operators should verify during an active remediation:**

| Check                            | Where                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Defect list posted               | Jira comment on the ticket (structured markdown)                                   |
| Build crew picked up remediation | `delivery-build` logs; ticket in **In Remediation** with `qa-remediation` label    |
| QA waiting                       | `delivery-qa` logs `workflow.qa.complete` with `terminalStep: remediation-pending` |
| Timeout clock                    | `REMEDIATION_TIMEOUT_HOURS` from `remediation-pending` `started_at` in SQLite      |
| Successful return                | Ticket back in **In QA**; `workflow.qa.remediation-resume` in QA logs              |
| Downstream handoff               | Ticket in **In Review**; `workflow.handoff-to-review` with `issueKey` and `mrUrl`  |

**Do not** manually edit Jira status across the remediation boundary unless
coordinating a stuck loop — prefer letting the crews drive transitions. If you
must intervene, ensure the MR is CI-green before moving a ticket to **In QA**.

---

## 8. Accepted defaults (design open questions)

The following defaults were accepted for EPIC-05 implementation. Revisit via
backlog if production operation diverges.

| #   | Question                    | Accepted default                                                                                                                                                                                                                         |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Jira status for remediation | Distinct status **In Remediation** (not reusing **In Progress**). Label `qa-remediation` is always applied.                                                                                                                              |
| 2   | MR discovery                | Resolve open MR via GitLab search (`findOpenMrForIssue`) — same convention as `delivery-build` post-`open-mr`.                                                                                                                           |
| 3   | QA bot Jira assignee        | **Separate service account** from the build engineer (`JIRA_ASSIGNEE_ACCOUNT_ID` on each crew). Status-based pollers prevent cross-pickup.                                                                                               |
| 4   | E2E command scope           | `AUTOMATED_TEST_COMMAND` defaults to `pnpm test`; optional `E2E_TEST_COMMAND` for a second pass. Projects with split suites set both explicitly.                                                                                         |
| 5   | Handoff event typing        | Crew-local structured log contracts (`workflow.handoff-to-review`, `workflow.remediation-required`) — no shared `HandoffEvent` type in `@daddia/crew` (per solution.md §5.1). Downstream crews consume Jira state, not log subscription. |

---

## 9. Pre-production security checklist

Run before every new deployment or credential rotation. Trust-boundary detail:
[`docs/architecture/security-model.md`](../architecture/security-model.md).

| #   | Check                                                           | How to verify                                                                |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Jira webhook URL points at `/webhooks/jira` with HMAC secret    | Jira admin → Webhooks; secret matches `JIRA_WEBHOOK_SECRET`                  |
| 2   | Webhook secret meets minimum length                             | Railway env: `JIRA_WEBHOOK_SECRET` ≥ 16 characters                           |
| 3   | Unsigned or replayed Jira events rejected                       | Bad signature → `403`; stale timestamp → `400`                               |
| 4   | Duplicate webhook deliveries idempotent                         | Re-post same Jira `id` → `{ duplicate: true }`                               |
| 5   | API tokens in platform env only                                 | No tokens in Dockerfile, git, or `mcp.json` literals                         |
| 6   | Boot log redacts secrets                                        | `config.loaded` omits token values                                           |
| 7   | MCP servers boot with injected credentials                      | `pnpm diagnose` → "MCP servers boot" passes                                  |
| 8   | SQLite state persists across redeploys                          | Volume at `/data`; `DB_PATH=/data/delivery-qa.db`                            |
| 9   | `qa-engineer` allowlist excludes merge / protected-branch tools | Review `agents/qa-engineer/agent.ts` `allowedTools`                          |
| 10  | Author-controlled Jira/MR/test output delimiter-fenced          | `pnpm test` in `crews/delivery-qa` — prompt-context tests pass               |
| 11  | Workflow context from integration APIs, not webhook bodies      | Handlers pass `issueKey` only into `runQaWorkflow`                           |
| 12  | Loop caps set for production load                               | `QA_DEFECT_LOOP_CAP` and `REMEDIATION_TIMEOUT_HOURS` reviewed in Railway env |
| 13  | CI invariant guard green                                        | `pnpm guard:invariants` exits 0 on `main`                                    |

Do not deploy while any item fails verification.
