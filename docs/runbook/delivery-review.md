---
type: Runbook
version: '0.1'
status: Active
last_updated: 2026-06-27
related:
  - crews/delivery-review/src/config.ts
  - docs/design/crew-flows/delivery-review.md
  - docs/runbook/delivery-qa.md
  - docs/runbook/container.md
  - docs/architecture/security-model.md
  - docs/work/06-delivery-review/design.md
---

# Operations Runbook — `delivery-review`

The `delivery-review` crew picks up Jira stories in **In Review**, runs a tech-lead
final code review (architecture + technical AC gate), pauses for blocking PM
stakeholder sign-off, merges the CI-green MR to `main` via the GitLab API, posts
a review summary, and transitions the ticket to **Done**. The canonical flow
contract: [`docs/design/crew-flows/delivery-review.md`](../design/crew-flows/delivery-review.md).
Env var schema (authoritative): [`crews/delivery-review/src/config.ts`](../../crews/delivery-review/src/config.ts).

---

## 1. Pre-deploy checklist

Before every deploy or configuration change, run `pnpm diagnose` against the target
environment to confirm all integration checks pass.

### 1.1 Set environment variables in the shell

Export the same variables that will be injected into the Railway service (see
[§2.2 Environment variables](#22-environment-variables) for the full table):

```sh
export ANTHROPIC_API_KEY=...
export ATLASSIAN_EMAIL=...
export ATLASSIAN_API_TOKEN=...
export ATLASSIAN_BASE_URL=https://yourorg.atlassian.net
export JIRA_PROJECT_KEY=...
export JIRA_ASSIGNEE_ACCOUNT_ID=...          # Review bot account ID
export JIRA_ACCEPTANCE_CRITERIA_FIELD_ID=customfield_10042
export PM_APPROVER_ACCOUNT_IDS=...           # Comma-separated PM account IDs (required)
export GITLAB_PERSONAL_ACCESS_TOKEN=...
export GITLAB_API_URL=https://gitlab.com/api/v4
export GITLAB_PROJECT_ID=...
export GITLAB_DEFAULT_BRANCH=main
export JIRA_WEBHOOK_SECRET=...
export DB_PATH=/tmp/delivery-review-preflight.db
export PM_REVIEW_TIMEOUT_HOURS=48
export PM_APPROVAL_COMMENT_PATTERN=/pm-approve
```

### 1.2 Run the diagnostics

From the repo root, build the crew and run the diagnostics script:

```sh
pnpm build
cd crews/delivery-review
pnpm diagnose
```

Expected output when all checks pass:

```text
✓ Jira API reachability: https://yourorg.atlassian.net is reachable
✓ Jira project key: project CREW exists
✓ Jira transitions: all three required transitions present
✓ GitLab API reachability: https://gitlab.com/api/v4 is reachable
✓ GitLab MR lookup: MR search API responded for probe key CREW-123
✓ MCP servers boot: all 2 MCP server(s) responded to initialize
✓ DB_PATH directory writable: /tmp

All 7 checks passed.
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
| GitLab MR lookup           | `MR search returned HTTP ...`         | Confirm token has MR read access on the project                                   |
| MCP servers boot           | `timed out waiting for MCP handshake` | Ensure `npx` is on PATH; check `ATLASSIAN_*` and `GITLAB_*` values                |
| DB_PATH directory writable | `... is not writable`                 | Confirm the parent directory exists and is writable                               |

The three required Jira transitions are: `In Review`, `Done`, `Needs human review`.
If any are missing, add them in the Jira board project settings under "Workflows".

Boot fails with `SchemaValidationError` when `PM_APPROVER_ACCOUNT_IDS` is empty —
at least one PM approver account ID is required.

---

## 2. Deploy

Deployment uses Railway. The Dockerfile copies from `packages/` and `tooling/`,
so the Docker build context must be the **repository root**.

### 2.1 Railway service configuration

| Dashboard field | Value                                   |
| --------------- | --------------------------------------- |
| Root Directory  | _(leave blank — defaults to repo root)_ |
| Dockerfile Path | `crews/delivery-review/Dockerfile`      |

Set `PORT=3002` (default in the image) and mount a persistent volume for SQLite
state — see [§2.3 Persistent volume](#23-persistent-volume).

Port allocation across the delivery vertical:

| Crew              | Default port |
| ----------------- | ------------ |
| `delivery-build`  | `3000`       |
| `delivery-qa`     | `3001`       |
| `delivery-review` | `3002`       |

### 2.2 Environment variables

Canonical schema: [`crews/delivery-review/src/config.ts`](../../crews/delivery-review/src/config.ts).

#### Required

| Variable                            | Description                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                 | Anthropic API key for `tech-lead` agent runs                                                         |
| `ATLASSIAN_EMAIL`                   | Atlassian account email for Jira API auth                                                            |
| `ATLASSIAN_API_TOKEN`               | Atlassian API token                                                                                  |
| `ATLASSIAN_BASE_URL`                | Jira base URL (e.g. `https://yourorg.atlassian.net`)                                                 |
| `JIRA_PROJECT_KEY`                  | Jira project key (e.g. `CREW`)                                                                       |
| `JIRA_ASSIGNEE_ACCOUNT_ID`          | Jira account ID of the **review bot** — poller JQL filters on this assignee                          |
| `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID` | Custom field ID for acceptance criteria (e.g. `customfield_10042`)                                   |
| `PM_APPROVER_ACCOUNT_IDS`           | Comma-separated Atlassian account IDs allowed to PM-approve. Boot fails if empty.                    |
| `GITLAB_PERSONAL_ACCESS_TOKEN`      | GitLab PAT with `api` scope                                                                          |
| `GITLAB_API_URL`                    | GitLab API base (e.g. `https://gitlab.com/api/v4`)                                                   |
| `GITLAB_PROJECT_ID`                 | Numeric GitLab project ID                                                                            |
| `JIRA_WEBHOOK_SECRET`               | Shared secret for Jira webhook HMAC verification (≥ 16 characters)                                   |
| `DB_PATH`                           | SQLite file path (e.g. `/data/delivery-review.db` in production)                                     |

#### Behaviour and cost controls

| Variable                       | Default          | Description                                                                                                                                                                                |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PM_REVIEW_TIMEOUT_HOURS`      | `48`             | Maximum hours to wait in `stakeholder-review-pending` for a PM `/pm-approve` comment from an allowlisted account. Exceeded → automatic escalation to **Needs human review**.                 |
| `PM_APPROVAL_COMMENT_PATTERN`  | `/pm-approve`    | Substring a Jira comment must contain to count as PM approval. Only comments posted **after** the pending step started and from an account in `PM_APPROVER_ACCOUNT_IDS` qualify.             |
| `PM_APPROVER_ACCOUNT_IDS`      | _(required)_     | Comma-separated Atlassian account IDs of humans authorised to PM-approve. Merge is too privileged for any ticket commenter — configure explicitly for your team.                           |
| `POLL_INTERVAL_MS`             | `300000`         | Milliseconds between Jira polling ticks                                                                                                                                                    |
| `TECH_LEAD_MAX_TURNS`          | `30`             | Max agent turns per `tech-lead` step                                                                                                                                                       |
| `TECH_LEAD_COST_CAP_USD`       | `5`              | Per-step cost cap for `tech-lead` runs                                                                                                                                                     |
| `DIFF_FILE_CAP`                | `50`             | Maximum diff files the tech-lead review considers                                                                                                                                          |
| `DIFF_SIZE_CAP_BYTES`          | `500000`         | Maximum diff size in bytes for review                                                                                                                                                      |
| `GITLAB_DEFAULT_BRANCH`        | `main`           | Target branch for merge operations                                                                                                                                                         |
| `LOG_LEVEL`                    | `info`           | Log verbosity (`debug`, `info`, `warn`, `error`)                                                                                                                                           |
| `PORT`                         | `3002`           | HTTP listen port                                                                                                                                                                           |
| `CREW_ID`                      | `delivery-review`| Crew identifier in structured logs                                                                                                                                                         |
| `ATLASSIAN_ACCOUNT_ID`         | _(unset)_        | Bot account ID for webhook author filtering when needed                                                                                                                                    |
| `HONEYCOMB_API_KEY`            | _(unset)_        | Optional OTel export key                                                                                                                                                                   |
| `CREW_EVAL_FIXTURE_MODE`       | `mock`           | CrewBench fixture mode (`mock` or `live`) — not used in production                                                                                                                         |

### 2.3 Persistent volume

Provision a Railway volume once after linking the service:

```sh
# One-time setup — run after `railway link` has associated the CLI with the service.
railway volume add --mount-path /data
railway variables set DB_PATH=/data/delivery-review.db
```

Without a persistent volume the SQLite state is wiped on every redeploy — the
crash-recovery scan becomes a no-op, PM pending timers reset, and story
deduplication is lost.

### 2.4 Webhook registration

After the service is live, register the Railway public URL with Jira:

| Provider | URL                                      | Trigger                         |
| -------- | ---------------------------------------- | ------------------------------- |
| Jira     | `https://<railway-domain>/webhooks/jira` | Issue transitioned to **In Review** |

The poller is the fallback trigger when webhooks are delayed or missed.

### 2.5 Cross-crew prerequisites

`delivery-qa` must be deployed and configured to:

- Transition stories to **In Review** after QA validation passes.
- Emit `workflow.handoff-to-review` in logs (observability only — this crew
  consumes Jira state, not log subscription).

See [`docs/runbook/delivery-qa.md`](delivery-qa.md) for the upstream crew.

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
logs for `poller.start`. If `poller.search-error` appears, verify `ATLASSIAN_*`
credentials and that `JIRA_ASSIGNEE_ACCOUNT_ID` is the review bot account.

---

## 4. Monitoring

### 4.1 Log events to alert on

| Event                                        | Level | Meaning                                                           | Recommended action                                                                     |
| -------------------------------------------- | ----- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `workflow.escalate`                          | warn  | Story escalated to human review                                   | Check `reason`; review the Jira escalation comment                                     |
| `poller.stakeholder-timeout`                 | warn  | `PM_REVIEW_TIMEOUT_HOURS` exceeded while awaiting PM sign-off     | Contact PM or manually approve; see [§5.1](#51-pm-approval-timeout)                      |
| `poller.stakeholder-external-merge-error`    | error | MR merged externally while Jira still In Review                   | Reconcile Jira state manually; see [§5.6](#56-external-merge-inconsistency)            |
| `poller.search-error`                        | warn  | Jira API unreachable during a poll tick                           | Verify `ATLASSIAN_*` credentials and Jira status                                       |
| `recovery.session-failed`                    | warn  | Boot-time crash recovery could not reconnect an SDK session       | Story escalated automatically; review the Jira ticket                                  |
| `workflow.merge-and-close.error`             | error | GitLab approve or merge API call failed                           | Check GitLab permissions and MR state; see [§5.5](#55-merge-api-failure)               |
| `config.invalid`                             | error | Config schema validation failed at boot                           | Service will exit; fix the bad env var and redeploy                                    |
| `poller.misconfigured`                       | warn  | `JIRA_PROJECT_KEY` or `JIRA_ASSIGNEE_ACCOUNT_ID` is blank         | Fix Railway env; no stories will be picked up                                          |

### 4.2 Normal steady-state events

| Event                                       | Level | Meaning                                                                                  |
| ------------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `server.start`                              | info  | HTTP server is listening                                                                 |
| `config.loaded`                             | info  | Config validated and loaded at boot (secrets redacted)                                   |
| `workflow.review.start`                     | info  | Story entered the review workflow                                                        |
| `workflow.blocked.stakeholder-review`       | info  | Tech-lead approved; awaiting PM sign-off — HITL pause entered                            |
| `poller.stakeholder-resolved`               | info  | PM approval detected; resuming at merge-and-close                                        |
| `workflow.handoff-done`                     | info  | Story merged and transitioned to **Done** — delivery vertical closed for this issue      |
| `poller.stakeholder-reconciled`             | info  | MR already merged and Jira already Done — local state reconciled                         |

### 4.3 `workflow.handoff-done` payload

Emitted at successful terminal exit. Key fields:

| Field            | Type   | Notes                                                       |
| ---------------- | ------ | ----------------------------------------------------------- |
| `issueKey`       | string | Jira issue key                                              |
| `mrUrl`          | string | GitLab MR web URL                                           |
| `mergeCommitSha` | string | SHA of the merge commit on `main`                           |

---

## 5. PM approval playbook

After tech-lead final code review passes, the workflow enters
`stakeholder-review-pending` — a blocking human-in-the-loop pause. Merge cannot
proceed until a PM posts explicit sign-off on the Jira ticket.

### 5.0 Operator flow

```text
tech-lead final-code-review passes
  → Jira comment posted with PM sign-off instructions
  → state: stakeholder-review-pending
  → log workflow.blocked.stakeholder-review
  → HITL PAUSE ──────────────────►  PM reviews ticket + MR
                                      → posts Jira comment containing /pm-approve
  ◄───────────────────────────────
poller detects approval (allowlisted account, after pending started_at)
  → log poller.stakeholder-resolved
  → resume at merge-and-close (approve + merge via GitLab API)
  → tech-lead publish-review-summary
  → Jira In Review → Done
  → log workflow.handoff-done
```

**What the PM must do:**

1. Open the Jira ticket — it remains in **In Review** during the pause.
2. Review the tech-lead summary comment and the linked MR diff.
3. Post a Jira comment containing `/pm-approve` (or the configured
   `PM_APPROVAL_COMMENT_PATTERN`) from an account listed in
   `PM_APPROVER_ACCOUNT_IDS`.
4. Wait for the poller to detect the comment (default: up to one poll interval,
   5 minutes) and complete merge automatically.

**Approval probe rules (v1 defaults):**

| Rule | Detail |
| ---- | ------ |
| Signal | Jira comment body contains `PM_APPROVAL_COMMENT_PATTERN` (default `/pm-approve`) |
| Author | Comment `accountId` must be in `PM_APPROVER_ACCOUNT_IDS` |
| Timing | Comment `created` timestamp must be **after** `stakeholder-review-pending` step `started_at` |
| No labels or custom fields | Comment pattern only — see design §1 locked decisions |

Comments from non-allowlisted accounts or posted before the pending step started
are ignored. The crew does not send reminders — PM availability is bounded by
`PM_REVIEW_TIMEOUT_HOURS`.

---

## 6. Escalation playbooks

Every failure branch transitions the Jira ticket to **Needs human review** with a
comment and logs `workflow.escalate` — the workflow never throws to the HTTP layer.

### 6.1 PM approval timeout

**Cause:** The story has been in local state `stakeholder-review-pending` longer
than `PM_REVIEW_TIMEOUT_HOURS` without a qualifying PM approval comment. The
poller's `pollStakeholderPendingStories` fires on each tick.

**Automatic action:** `poller.stakeholder-timeout` warn →
`escalateToHumanReview` with reason
`PM approval timeout — no sign-off received within N hours`. Ticket moves to
**Needs human review**.

**Operator steps:**

1. Confirm no `/pm-approve` comment exists from an allowlisted account after the
   pending step started.
2. If PM was unavailable, coordinate sign-off offline.
3. To retry after manual resolution: transition the ticket back to **In Review**
   (assign to review bot) and let the crew re-run, or merge manually and close
   the ticket.
4. If `PM_REVIEW_TIMEOUT_HOURS` is too aggressive for your team SLA, raise it in
   Railway env — see [§7.1](#71-pm_review_timeout_hours).

### 6.2 Review block

**Cause:** `tech-lead` returns `verdict: block` at `final-code-review` — architecture,
technical AC, or security blockers that make merge unsafe. There is no send-back
loop to `delivery-build` or `delivery-qa` in v1.

**Automatic action:** Structured blocker comment posted on Jira →
`escalateToHumanReview` with reason `Final code review blocked` (or agent
summary). Ticket moves to **Needs human review**. No merge attempt is made.

**Operator steps:**

1. Review the blocker comment on the Jira ticket and the MR diff.
2. Decide whether to fix manually, send back to engineering outside the crew
   workflow, or close the story.
3. To retry: address blockers, ensure CI is green, transition back to **In Review**.

### 6.3 Pipeline not green

**Cause:** At `context-seed` or `merge-and-close`, the GitLab pipeline for the
linked MR is not `success`. Review and merge must not proceed against failing CI.

**Automatic action:** `escalateToHumanReview` with reason
`CI pipeline not green at review start (status: <status>)` or
`CI pipeline not green before merge (status: <status>)`. Ticket moves to
**Needs human review**.

**Operator steps:**

1. Open the MR in GitLab; confirm pipeline status.
2. If the failure is transient, re-run the pipeline and wait for green.
3. Transition the Jira ticket back to **In Review** once CI is green.
4. If the failure is legitimate, assign to an engineer to fix before re-entering review.

### 6.4 Merge API failure

**Cause:** GitLab `approveMergeRequest` or `mergeMergeRequest` throws at
`merge-and-close` after PM approval (permissions, MR conflicts, branch protection,
or GitLab outage).

**Automatic action:** `workflow.merge-and-close.error` error →
`escalateToHumanReview` with reason `GitLab approve or merge failed`. Ticket
moves to **Needs human review**.

**Operator steps:**

1. Check GitLab MR state — is it still open? Are there merge conflicts?
2. Verify the bot token has `Developer` or higher role with merge rights.
3. Confirm project merge method in GitLab UI (crew uses project default — no
   squash/ff override in v1).
4. Resolve conflicts or permissions, then either merge manually and transition
   Jira to **Done**, or re-transition to **In Review** for a crew retry.

### 6.5 External merge inconsistency

**Cause:** While awaiting PM approval, someone merged the MR externally (GitLab
UI or another tool) but Jira is still **In Review**. The poller detects
`mrState.state === 'merged'` with Jira status not **Done**.

**Automatic action:** `escalateToHumanReview` with reason
`MR merged externally while awaiting PM approval — Jira still In Review`.

**Operator steps:**

1. Confirm the MR is merged in GitLab and the code is on `main`.
2. If PM approval was obtained out-of-band, transition Jira to **Done** manually
   and clear the local SQLite story row if needed.
3. If merge happened without PM sign-off, treat as a process violation — review
   with the team and update branch protection if needed.

**Reconciliation path:** If MR is merged **and** Jira is already **Done**, the
poller reconciles local state to `done` without escalation (`poller.stakeholder-reconciled`).

### 6.6 Agent step failure

**Cause:** `tech-lead` returns `success: false` at `final-code-review` or
`publish-review-summary` without a block verdict.

**Automatic action:** Escalate at the current step.

**Operator steps:** Review agent session logs (if available), Jira comments, and
MR state. Fix root cause and re-transition to **In Review**.

### 6.7 In-flight story on boot (crash recovery)

**Cause:** Process crashed mid-agent-run. The `steps` table has a row where
`session_id IS NOT NULL` and `finished_at IS NULL`.

**Automatic action:** `recoverInterruptedSteps` runs once at boot. Reconnects the
SDK session and restarts `runReviewWorkflow`, or escalates on failure
(`recovery.session-failed`).

**Manual steps if auto-recovery escalates:**

1. Check `recovery.session-failed` for `issueKey` and `sessionId`.
2. Review the Jira escalation comment.
3. Clear the interrupted row if re-running from scratch:
   `DELETE FROM steps WHERE issue_key = '<ISSUE_KEY>' AND finished_at IS NULL;`
4. Transition the Jira issue back to **In Review**.

### 6.8 SQLite volume loss

Same recovery pattern as [`delivery-build.md` §5.4](delivery-build.md#54-sqlite-volume-loss).
Re-attach the volume, set `DB_PATH=/data/delivery-review.db`, redeploy, and audit
in-flight Jira tickets — especially those in `stakeholder-review-pending`.

---

## 7. Cost controls and tuning

### 7.1 `PM_REVIEW_TIMEOUT_HOURS`

Maximum wait for PM stakeholder sign-off before escalation. Default: `48`.

**Tuning:** Lower to `24` for time-sensitive delivery. Raise to `72` when PMs
are in different time zones. Does not affect agent cost — only idle time before
escalation. Should reflect team SLA for stakeholder availability.

### 7.2 `PM_APPROVER_ACCOUNT_IDS`

Required allowlist — boot fails if empty. Configure every human authorised to
PM-approve. Small teams typically have one PM account ID.

**Tuning:** Add comma-separated account IDs when multiple PMs can sign off.
Find account IDs in Jira user profile URLs or via the Atlassian admin API.

### 7.3 `PM_APPROVAL_COMMENT_PATTERN`

Substring match for PM approval comments. Default: `/pm-approve`.

**Tuning:** Change only if `/pm-approve` conflicts with ticket content. The
pattern is a substring match, not a regex. Comments must still come from
allowlisted accounts after the pending step started.

### 7.4 `TECH_LEAD_MAX_TURNS` and `TECH_LEAD_COST_CAP_USD`

Per-step guardrails on `tech-lead` agent runs. Defaults: `30` turns, `$5` USD.

**Tuning:** Lower cost cap if final reviews are running long on large diffs.
Adjust `DIFF_FILE_CAP` and `DIFF_SIZE_CAP_BYTES` if reviews truncate important files.

---

## 8. Accepted defaults (design §1 locked decisions)

The following defaults were locked for CREW-06 implementation. Revisit via
backlog if production operation diverges.

| #   | Decision               | Accepted default                                                                                                                                                                                                                         |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | PM approval signal     | Jira comment containing `/pm-approve` after `stakeholder-review-pending` `started_at` — no labels, no custom fields                                                                                                                     |
| 2   | PM approver identity   | **Required** `PM_APPROVER_ACCOUNT_IDS` allowlist (comma-separated Atlassian account IDs); boot fails if empty                                                                                                                             |
| 3   | Review bot assignee    | **Dedicated Jira user** per deployment (`JIRA_ASSIGNEE_ACCOUNT_ID`); shared Atlassian API token is fine — status-scoped pollers do not fight over one assignee                                                                           |
| 4   | Merge strategy         | `mergeMergeRequest` with **no squash/ff override** — GitLab project default wins; change merge method in GitLab UI if needed                                                                                                             |
| 5   | Code-review skill      | Crew-local `final-code-review` skill composing shared `code-review` plugin — no `@daddia/crew` publish in this epic                                                                                                                      |
| 6   | Send-back on blockers  | Escalate to **Needs human review** — no send-back loop to `delivery-build` or `delivery-qa` in v1                                                                                                                                        |
| 7   | Four-eyes merge        | **Not enforced** — tech-lead reviews; workflow merges deterministically after both gates pass                                                                                                                                            |
| 8   | Handoff event typing   | Crew-local structured log contracts (`workflow.handoff-done`, `workflow.blocked.stakeholder-review`) — downstream consumers use Jira **Done** state, not log subscription                                                                 |

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
| 6   | Boot log redacts secrets                                        | `config.loaded` omits token values                                             |
| 7   | MCP servers boot with injected credentials                      | `pnpm diagnose` → "MCP servers boot" passes                                  |
| 8   | SQLite state persists across redeploys                          | Volume at `/data`; `DB_PATH=/data/delivery-review.db`                        |
| 9   | `tech-lead` allowlist excludes merge / protected-branch tools   | Review `agents/tech-lead/agent.ts` `allowedTools`                            |
| 10  | Author-controlled Jira/MR text delimiter-fenced                 | `pnpm test` in `crews/delivery-review` — prompt-context tests pass           |
| 11  | Workflow context from integration APIs, not webhook bodies      | Handlers pass `issueKey` only into `runReviewWorkflow`                       |
| 12  | PM approver allowlist configured                                | `PM_APPROVER_ACCOUNT_IDS` non-empty; only listed accounts can trigger merge  |
| 13  | PM timeout reviewed for production SLA                          | `PM_REVIEW_TIMEOUT_HOURS` set appropriately in Railway env                   |
| 14  | CI invariant guard green                                        | `pnpm guard:invariants` exits 0 on `main`                                    |

Do not deploy while any item fails verification.
