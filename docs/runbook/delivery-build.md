---
type: Runbook
version: '0.3'
status: Active
last_updated: 2026-06-26
related:
  - crews/delivery-build/README.md
  - docs/design/crew-flows/delivery-build.md
  - docs/runbook/container.md
  - docs/architecture/security-model.md
---

# Operations Runbook — `delivery-build`

The `delivery-build` crew picks up assigned Jira stories, implements them via
the `engineer` and `senior-engineer` personas, opens a GitLab MR, monitors CI,
and transitions the ticket to "In QA". The canonical flow contract:
[`docs/design/crew-flows/delivery-build.md`](../design/crew-flows/delivery-build.md).
Env var reference (canonical): [`crews/delivery-build/README.md`](../../crews/delivery-build/README.md).

---

## 1. Pre-deploy checklist

Before every deploy or configuration change, run `pnpm diagnose` against the target environment to confirm all six integrations are reachable and correctly configured.

### 1.1 Set environment variables in the shell

Export the same variables that will be injected into the Railway service:

```sh
export ANTHROPIC_API_KEY=...
export ATLASSIAN_EMAIL=...
export ATLASSIAN_API_TOKEN=...
export ATLASSIAN_BASE_URL=https://yourorg.atlassian.net
export JIRA_PROJECT_KEY=...
export JIRA_ASSIGNEE_ACCOUNT_ID=...
export GITLAB_PERSONAL_ACCESS_TOKEN=...
export GITLAB_API_URL=https://gitlab.com/api/v4
export GITLAB_PROJECT_ID=...
export JIRA_WEBHOOK_SECRET=...
export GITLAB_WEBHOOK_SECRET=...
export DB_PATH=/tmp/delivery-build-preflight.db
```

### 1.2 Run the diagnostics

From the repo root, build the crew and run the diagnostics script:

```sh
pnpm build
cd crews/delivery-build
pnpm diagnose
```

Expected output when all checks pass:

```text
✓ Jira API reachability: https://yourorg.atlassian.net is reachable
✓ Jira project key: project CREW exists
✓ Jira transitions: all four required transitions present
✓ GitLab API reachability: https://gitlab.com/api/v4 is reachable
✓ MCP servers boot: all 2 MCP server(s) responded to initialize
✓ DB_PATH directory writable: /tmp

All 6 checks passed.
```

`pnpm diagnose` exits with code `0` when all checks pass and code `1` when any
check fails. Do not deploy while any check is failing.

### 1.3 Diagnosing failures

| Check                      | Failure detail                        | Likely fix                                                         |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| Jira API reachability      | `HTTP 401`                            | Verify `ATLASSIAN_API_TOKEN` and `ATLASSIAN_EMAIL`                 |
| Jira API reachability      | `HTTP 403` or DNS error               | Confirm `ATLASSIAN_BASE_URL` is correct and reachable              |
| Jira project key           | `HTTP 404`                            | Confirm `JIRA_PROJECT_KEY` matches the board key                   |
| Jira transitions           | `missing transitions: ...`            | Add the missing transitions in the Jira board workflow editor      |
| GitLab API reachability    | `HTTP 401`                            | Confirm `GITLAB_PERSONAL_ACCESS_TOKEN` has `api` scope             |
| GitLab API reachability    | `HTTP 404`                            | Confirm `GITLAB_PROJECT_ID` is the numeric ID, not the path        |
| MCP servers boot           | `timed out waiting for MCP handshake` | Ensure `npx` is on PATH; check `ATLASSIAN_*` and `GITLAB_*` values |
| DB_PATH directory writable | `... is not writable`                 | Confirm the parent directory exists and is writable                |

The four required Jira transitions are: `In Progress`, `Clarification Needed`,
`In QA`, `Needs human review`. If any are missing, add them in the Jira board
project settings under "Workflows".

---

## 2. Deploy

Deployment uses Railway. The Dockerfile copies from `packages/` and `tooling/`,
so the Docker build context must be the **repository root**.

### 2.1 Railway service configuration

| Dashboard field  | Value                                   |
| ---------------- | --------------------------------------- |
| Root Directory   | _(leave blank — defaults to repo root)_ |
| Config File Path | `crews/delivery-build/railway.json`     |

### 2.2 Environment variables

Set every variable from the canonical reference in
[`crews/delivery-build/README.md`](../../crews/delivery-build/README.md) on the
Railway service dashboard. That table is the single source of truth for which
variables are required vs optional and what each one accepts; do not duplicate
the list here.

### 2.3 Persistent volume

Railway does not support volume configuration in `railway.json`. Provision the
volume once via the CLI after linking the service, then it persists across all
future redeploys:

```sh
# One-time setup — run after `railway link` has associated the CLI with the service.
railway volume add --mount-path /data
railway variables set DB_PATH=/data/delivery-build.db
```

Alternatively, use the Railway dashboard: add a volume, set the mount path to
`/data`, and set `DB_PATH=/data/delivery-build.db` in the service variables.

Without a persistent volume the SQLite state is wiped on every redeploy — the
crash-recovery scan becomes a no-op and story deduplication is lost.

### 2.4 Webhook registration

After the service is live, register the Railway public URL with both providers:

| Provider | URL                                        | Trigger                               |
| -------- | ------------------------------------------ | ------------------------------------- |
| Jira     | `https://<railway-domain>/webhooks/jira`   | Issue transitioned to "Ready for Dev" |
| GitLab   | `https://<railway-domain>/webhooks/gitlab` | MR note (comment) events              |

---

## 3. Smoke test

Verify the service is alive and the poller is ticking after each deploy.

### 3.1 Health endpoint

```sh
curl -s https://<railway-domain>/healthz | jq .
```

Expected response:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "poller": {
    "lastTickAt": 1747048400000,
    "lastTickStatus": "ok",
    "inFlightCount": 0,
    "inFlight": []
  },
  "db": {
    "ok": true,
    "path": "/data/delivery-build.db"
  }
}
```

| Field                   | Healthy value                               | Degraded signal                                                                    |
| ----------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ok`                    | `true`                                      | `false` — service is up but degraded                                               |
| `poller.lastTickAt`     | Epoch ms within the last `POLL_INTERVAL_MS` | `null` — poller has not ticked yet (normal on first boot until the interval fires) |
| `poller.lastTickStatus` | `"ok"`                                      | `"error"` — Jira search failed on the last tick                                    |
| `db.ok`                 | `true`                                      | `false` — SQLite connection is broken; check volume mount                          |

The endpoint always returns HTTP 200 — read the body fields to detect
degraded state.

### 3.2 Confirm the poller ticks within `POLL_INTERVAL_MS`

After the service starts, wait one poll interval (default: 5 minutes) and
re-request `/healthz`. `poller.lastTickAt` should be non-null and
`poller.lastTickStatus` should be `"ok"`.

If `lastTickStatus` is `"error"`, the Jira search failed. Check the Railway log
stream for a `poller.search-error` event and verify the `ATLASSIAN_*` credentials.

---

## 4. Monitoring

### 4.1 Log events to alert on

| Event                                     | Level | Meaning                                                     | Recommended action                                                                                        |
| ----------------------------------------- | ----- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `workflow.escalate`                       | warn  | A story was escalated to human review                       | Check `reason`; review the Jira ticket for the escalation comment                                         |
| `poller.search-error`                     | warn  | Jira API unreachable during a poll tick                     | Verify `ATLASSIAN_*` credentials and Jira status; check `/healthz` `poller.lastTickStatus`                |
| `recovery.session-failed`                 | warn  | Boot-time crash recovery could not reconnect an SDK session | The story has been escalated automatically; review the Jira ticket                                        |
| `workflow.complete` with `success: false` | info  | Story reached a terminal step without landing in QA         | Check `terminalStep`; `needs-human-review` means escalation; `clarification-pending` means waiting for PM |
| `config.invalid`                          | error | Config schema validation failed at boot                     | Service will exit; fix the bad env var and redeploy                                                       |
| `poller.misconfigured`                    | warn  | `JIRA_PROJECT_KEY` or `JIRA_ASSIGNEE_ACCOUNT_ID` is blank   | Fix the Railway env var; no stories will be picked up until corrected                                     |
| `poller.clarification-timeout`            | warn  | A story timed out waiting for PM clarification              | Review the Jira ticket; story has been escalated to "Needs human review"                                  |

### 4.2 Normal steady-state events

These events appear during healthy operation and do not require action:

| Event                                    | Level | Meaning                                                        |
| ---------------------------------------- | ----- | -------------------------------------------------------------- |
| `server.start`                           | info  | HTTP server is listening                                       |
| `config.loaded`                          | info  | Config validated and loaded at boot                            |
| `poller.start`                           | info  | Poller interval registered                                     |
| `workflow.start`                         | info  | A story entered the workflow                                   |
| `workflow.handoff-to-qa`                 | info  | Story successfully reached "In QA"                             |
| `workflow.complete` with `success: true` | info  | Story completed; `totalCostUsd` and `durationMs` are available |
| `workflow.blocked.clarification`         | info  | Story parked; engineer posted clarifying questions to Jira     |

### 4.3 `workflow.complete` payload

Emitted at every terminal exit point (`in-qa`, `needs-human-review`,
`clarification-pending`). Key fields:

| Field          | Type    | Notes                                                     |
| -------------- | ------- | --------------------------------------------------------- |
| `issueKey`     | string  | Jira issue key                                            |
| `terminalStep` | string  | `in-qa`, `needs-human-review`, or `clarification-pending` |
| `success`      | boolean | `true` only when `terminalStep` is `in-qa`                |
| `totalCostUsd` | number  | Aggregate cost across all agent steps                     |
| `stepCount`    | number  | Total steps including non-agent steps                     |
| `agentSteps`   | array   | Per-agent-step: `{ step, sessionId, costUsd }`            |
| `durationMs`   | number  | Wall time from first step to terminal step                |
| `mrUrl`        | string  | Present when an MR was opened                             |

---

## 5. Recovery

### 5.1 In-flight story on boot (crash recovery)

**Cause:** The process crashed while an agent session was running. The `steps`
table has a row where `session_id IS NOT NULL` and `finished_at IS NULL`.

**Automatic action:** `recoverInterruptedSteps` runs once at boot before the
HTTP server and poller start. For each interrupted row, it attempts to reconnect
the SDK session. If the session is still accessible, the story restarts from the
beginning of `runStory`. If reconnection fails, the story is transitioned to
"Needs human review" and a `recovery.session-failed` warn is logged.

**Manual steps if auto-recovery escalates:**

1. Check the `recovery.session-failed` log entry for `issueKey` and `sessionId`.
2. Review the Jira ticket; the escalation comment names the cause.
3. Resolve the root cause (e.g. transient SDK outage).
4. In the Railway SQLite console or via an SSH session, clear the interrupted row (`DELETE FROM steps WHERE issue_key = '<ISSUE_KEY>' AND finished_at IS NULL;`).
5. Transition the Jira issue back to "To Do". The next poll tick re-picks it.

### 5.2 Clarification timeout

**Cause:** A story was parked in "Clarification Needed" and no human comment
arrived within `CLARIFICATION_TIMEOUT_HOURS` (default: 24 h).

**Automatic action:** The poller detects the timeout, posts an escalation comment
on the Jira ticket, and transitions it to "Needs human review". The
`poller.clarification-timeout` warn is logged with `timeoutHours`.

**Manual steps:**

1. Review the Jira ticket for the unanswered engineer questions.
2. Post a PM reply addressing the questions.
3. Transition the Jira issue back to "To Do". The next poll tick re-picks it.

### 5.3 Refactor loop cap reached

**Cause:** `senior-engineer` requested changes and `engineer` addressed them the
maximum number of times without receiving approval. The `workflow.escalate` warn
is logged with `reason: "Refactor loop cap reached"`.

**Automatic action:** The story is transitioned to "Needs human review" with a
Jira comment listing the unresolved items from the final peer review.

**Manual steps:**

1. Review the GitLab branch diff and the unresolved items in the Jira escalation
   comment.
2. Manually resolve or dismiss the outstanding feedback on the branch.
3. Transition the Jira issue back to "To Do" to re-enter the workflow, or close
   it if the work is not worth retrying.
4. If the cap is consistently too low for the story type, raise `REFACTOR_LOOP_CAP`
   — see section 6.

### 5.4 SQLite volume loss

**Cause:** The Railway volume was detached, deleted, or the service was redeployed
without a volume, leaving `DB_PATH` pointing at a fresh (empty) database.

**Symptom:** Stories are re-processed that are already in progress elsewhere (no
deduplication state); or stories that should re-enter are skipped if the old
records were partially restored from a backup.

**Recovery steps:**

1. Re-attach or re-create the Railway volume and mount it at `/data`.
2. Confirm `DB_PATH=/data/delivery-build.db` in the service env.
3. Redeploy. Boot runs `recoverInterruptedSteps` against the fresh DB; no
   interrupted steps are found so recovery is a no-op.
4. Audit any Jira tickets that were in flight during the outage:
   - If the work should restart: transition the ticket to "To Do".
   - If the work should not restart: transition the ticket to "Needs human review"
     and add a comment noting the volume-loss event.

---

## 6. Cost controls

Three env vars cap how much agent work runs per story. All have defaults; override
them in the Railway service dashboard. For descriptions and accepted values, see
[`crews/delivery-build/README.md`](../../crews/delivery-build/README.md).

### 6.1 `REFACTOR_LOOP_CAP`

Controls the peer-review / address-feedback cycle. A cap of `N` allows up to
`N + 1` senior-engineer calls and at most `N` address-feedback calls. Default: `2`.

**Tuning:** Lower to `1` for small, well-specified stories. Raise to `3`–`4` for
stories with complex feedback or cross-cutting changes. Each increment adds
approximately one senior-engineer run and one engineer run to the per-story cost.

### 6.2 `CI_RETRY_CAP`

Controls how many times `engineer` attempts to fix a failing CI pipeline. Each
attempt is one engineer run. Default: `3`.

**Tuning:** Lower to `1`–`2` if CI failures are typically caused by flaky tests
or environment issues rather than code errors. Raise only for stories known to
require several fix cycles. After the cap is exhausted, the story escalates to
"Needs human review".

### 6.3 `CLARIFICATION_TIMEOUT_HOURS`

Hours the crew waits for a PM response before auto-escalating a story parked in
"Clarification Needed". Default: `24`.

**Tuning:** Lower to `8` for time-sensitive delivery windows. Raise to `48`–`72`
when PMs are in different time zones. This parameter does not affect agent cost —
it only controls how long a story idles before escalation.

### 6.4 Reading costs from logs

After each story completes, a `workflow.complete` `info` log is emitted with
`totalCostUsd`, `durationMs`, and the per-step `agentSteps` breakdown. Use
these values to baseline cost per story type and calibrate the caps above.

Example structured log query (if shipping logs to a log aggregator):

```text
event = "workflow.complete" AND success = true
| stats avg(totalCostUsd), max(totalCostUsd), avg(durationMs) by terminalStep
```

If `totalCostUsd` is materially higher than budget, reduce `REFACTOR_LOOP_CAP`
and `CI_RETRY_CAP` first — these are the highest-leverage levers. Check
`agentSteps` to identify which step is most expensive on typical stories.

---

## 7. Pre-production security checklist

Run this checklist before every new deployment or when rotating credentials.
Trust-boundary detail: [`docs/architecture/security-model.md`](../architecture/security-model.md).

Each item maps to an **existing control** (✓) or a **tracked gap** (○).

| #   | Check                                                                   | How to verify                                                                                      | Control / gap                                            |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Jira webhook URL points at `/webhooks/jira` with HMAC secret configured | Jira admin → Webhooks; secret matches `JIRA_WEBHOOK_SECRET`                                        | ✓ `verifySignature('jira', …)` in `handlers/jira.ts`     |
| 2   | GitLab webhook URL points at `/webhooks/gitlab` with shared token       | GitLab project → Webhooks; secret matches `GITLAB_WEBHOOK_SECRET`                                  | ✓ `verifySignature('gitlab', …)` in `handlers/gitlab.ts` |
| 3   | Webhook secrets meet minimum length                                     | Railway env: both secrets ≥ 16 characters                                                          | ✓ `config.ts` `Secret(z.string().min(16))`               |
| 4   | Unsigned or replayed Jira events are rejected                           | Send a test payload with bad signature → expect `403`; stale timestamp → `400`                     | ✓ `verifySignature` + `checkReplayWindow`                |
| 5   | Duplicate webhook deliveries are idempotent                             | Re-post the same Jira `id` → `{ duplicate: true }`, no second workflow                             | ✓ `webhook_events` + `checkAndRecord()`                  |
| 6   | API tokens live in platform env only                                    | No tokens in Dockerfile, git, or `mcp.json` literals; `${VAR}` interpolation only                  | ✓ `mcp.json` + `Secret()` in `config.ts`                 |
| 7   | Boot log redacts secrets                                                | Deploy; confirm `config.loaded` omits token values                                                 | ✓ `@daddia/crew/config` `redact()`                       |
| 8   | MCP servers boot with injected credentials                              | `pnpm diagnose` → "MCP servers boot" passes                                                        | ✓ diagnostics script                                     |
| 9   | SQLite state persists across redeploys                                  | Volume mounted at `/data`; `DB_PATH=/data/delivery-build.db`                                       | ✓ runbook §2.3                                           |
| 10  | Engineer allowlist excludes merge / protected-branch tools              | Review `engineer/agent.ts` and `senior-engineer/agent.ts` `allowedTools`; no `merge_merge_request` | ✓ `isProtectedBranchTool()` + `buildToolAllowlistGuard`  |
| 11  | Author-controlled Jira/MR text is delimiter-fenced                      | `pnpm test` in `crews/delivery-build` — `prompt-context` and engineer agent tests pass             | ✓ `formatAgentContext()` / `wrapUntrustedText()`         |
| 12  | Workflow passes integration-fetched context, not raw webhooks           | Handlers pass `issueKey` / MR identifiers only into `runStory` / `addressFeedback`                 | ✓ `AGENTS.md` context provenance                         |
| 13  | Loop caps set for production load                                       | `REFACTOR_LOOP_CAP` and `CI_RETRY_CAP` reviewed in Railway env                                     | ✓ `workflow.ts` + `boundedIterGuard`                     |
| 14  | CI invariant guard is green                                             | `pnpm guard:invariants` exits 0 on `main`                                                          | ✓ `tooling/invariants-guard`                             |
| 15  | Tool allowlist denial is eval-covered                                   | `crew eval` / `pnpm eval:ci` includes `tool-allowlist-denial.eval.ts` (local or eval pipeline)     | ✓ RH02-06 eval suite                                     |
| 16  | Kernel-level workspace sandbox                                          | Not required for org-owned target repos                                                            | ○ `CREW-19` (Later)                                      |
| 17  | OTel trace export to collector                                          | Optional for initial deploy                                                                        | ○ `CREW-08` (Next)                                       |
| 18  | Live run-stream for overnight batches                                   | Use structured logs + `/healthz` until shipped                                                     | ○ `RH02-09` (Next)                                       |

Do not deploy while any ✓ item fails verification. ○ items are documented
acceptances — note them in the deployment record and track via backlog.
