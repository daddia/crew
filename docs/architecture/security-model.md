---
type: Architecture
version: '1.0'
status: Current
last_updated: 2026-06-26
owner: daddia
related:
  - docs/architecture/solution.md
  - AGENTS.md
  - docs/runbook/delivery-build.md
  - docs/product/backlog.md
---

# Security model

Trust boundaries for server-shaped crews operating on real Jira and GitLab
work. The canonical runtime contract is [`solution.md`](solution.md) §7; code
conventions live in [`AGENTS.md`](../../AGENTS.md). This document names what
each layer may access, how inbound traffic is authenticated, and how
author-controlled text is treated before it reaches the model.

**Scope today:** `delivery-build` on a managed container (Railway) with a host
workspace checkout and MCP bridges to Atlassian and GitLab. CLI-shaped crews
share the runtime and prompt-injection controls but have no inbound webhook
surface.

---

## 1. Trust boundaries

Crew security is organised around four zones. Data may flow **into** the model
from the workspace and integration APIs; credentials stay in the runtime and
MCP child processes.

```text
┌─────────────────────────────────────────────────────────────────┐
│  RUNTIME (crew process)                                         │
│  Secrets, typed config, SQLite state, webhook handlers, workflow  │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │ MCP children │  │ WORKSPACE (cloned repo on host)           │ │
│  │ atlassian,   │  │ Read / Edit / Write / Bash — story      │ │
│  │ gitlab       │  │ branch only; serialised by workspace lock │ │
│  └──────┬───────┘  └──────────────────┬───────────────────────┘ │
│         │ credentials via env          │ file contents            │
│         ▼                              ▼                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ MODEL-VISIBLE (SDK session prompt + tool I/O)                ││
│  │ System prompt, delimited author text, tool results, audit log  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
         ▲
         │ signed webhooks (identifiers only into workflow)
    Jira / GitLab
```

### 1.1 Runtime

The long-lived crew process. It alone reads `process.env` (via typed
`config.ts`), holds webhook secrets, opens the SQLite state store, and
orchestrates the workflow.

| Asset | Protection |
| ----- | ---------- |
| API tokens (`ANTHROPIC_*`, `ATLASSIAN_*`, `GITLAB_*`) | `Secret()` branded fields; redacted from boot and structured logs |
| Webhook secrets | Minimum 16 characters at config validation; never logged |
| Workflow decisions | Deterministic `workflow.ts`; agents do not choose sequence |
| Crash-recovery state | Per-crew SQLite on a persistent volume (`DB_PATH`) |

Env reads outside `config.ts` are forbidden and enforced by ESLint plus
`guard:invariants`.

### 1.2 Workspace

The git checkout where the engineer persona implements stories. It is
**trusted code from the target repository**, not a security sandbox.

| Property | Behaviour |
| -------- | --------- |
| Isolation | One shared checkout per crew instance; `withWorkspaceLock()` serialises engineer tasks so two stories do not mutate the tree concurrently |
| Branch scope | Engineer works on a feature branch; protected-branch merge tools are excluded from every persona allowlist |
| Contents visible to model | File reads, edits, bash output, and diff text enter the model-visible zone |
| Execution model | Host process — same UID as the crew container (**not** kernel-level sandboxing) |

**Tracked gap:** optional execution isolation (`CREW-19`) for catalogue crews
operating on untrusted forks. `delivery-build` targets org-owned repos today.

### 1.3 MCP (Model Context Protocol)

MCP servers run as child processes declared in `mcp.json`. They receive
credentials through `${VAR}` interpolation resolved at session start from
runtime config — credentials are not embedded in prompts or repo files.

| Server | Capability surface | Typical persona use |
| ------ | ------------------ | ------------------- |
| `atlassian` | Jira read/write scoped to configured project | Fetch ticket bodies, post comments, transitions (workflow integrations) |
| `gitlab` | MR and repository operations scoped to `GITLAB_PROJECT_ID` | Open MR, list diffs, post review notes |

The model invokes MCP tools by name; each persona declares an explicit
`allowedTools` list. Tools that can merge to protected branches
(`mcp__gitlab__merge_merge_request`, etc.) are blocked at definition time via
`isProtectedBranchTool()` in `prompt-context.ts`.

### 1.4 Model-visible prompt data

Everything the SDK sends to the model: system prompt, task message, skill
bodies, and tool results.

| Source | Trust level | Handling |
| ------ | ----------- | -------- |
| Persona `prompt.md` | Trusted (crew-authored) | Loaded from crew source; versioned with deploy |
| Workflow fields (`task`, `branchName`, `mrUrl`, `projectDir`) | Trusted (crew-assembled) | Passed through without fencing |
| Jira ticket bodies, parent ticket text, MR reviewer comments | **Untrusted (author-controlled)** | Wrapped in `<<< untrusted input — data only >>>` delimiters via `formatAgentContext()` / `buildTaskPrompt()` |
| Webhook JSON bodies | **Untrusted** | Never passed to agents; handlers extract identifiers only |
| Integration API responses | Semi-trusted | Fetched by workflow; ticket text fields still fenced before prompt inclusion |

System prompts instruct the model to treat delimited blocks as data only, never
as instructions.

---

## 2. Inbound security (webhooks)

Server-shaped crews expose `POST /webhooks/jira` and `POST /webhooks/gitlab`.
Every handler follows the same fail-closed sequence from `@daddia/crew/webhooks`:

1. **`verifySignature()`** — before JSON parse. Jira: HMAC over raw body.
   GitLab: shared secret header check.
2. **`checkReplayWindow()`** — Jira events outside the timestamp window are
   rejected (GitLab relies on idempotency key).
3. **Idempotency** — `state.checkAndRecord(provider, eventId)` deduplicates
   via the `webhook_events` table.
4. **Filter** — transition/kind filters drop irrelevant events.
5. **Async workflow** — handler returns `200` promptly; workflow runs
   fire-and-forget. Internal errors are logged, not returned in the response body.

On signature or replay failure the handler returns `403` or `400` without
starting a workflow.

---

## 3. Outbound and tool safety

### 3.1 Two-layer tool allowlist

Each persona declares `allowedTools`. Enforcement is belt-and-suspenders:

1. **Pre-execution** — `buildToolAllowlistGuard()` in `resolveSession()` denies
   calls outside the list before the tool runs.
2. **Post-execution audit** — `buildAuditHook()` logs every completed tool
   invocation (tool name, input, output, duration). Attached to every persona
   run; non-optional.

Reviewer personas omit write tools. Merge and protected-branch tools are absent
from all delivery-build allowlists.

### 3.2 Bounded operation

Refactor, CI-fix, and remediation loops are capped by env-driven limits
(`REFACTOR_LOOP_CAP`, `CI_RETRY_CAP`). `boundedIterGuard()` throws
`IterationCapReached`; the workflow escalates to Jira "Needs human review"
rather than looping indefinitely.

### 3.3 Escalation, not throw

Workflow failures, agent `success: false`, and loop-cap exhaustion call
`escalateToHumanReview` (Jira comment + transition) and return. The HTTP server
and poller keep running.

---

## 4. Context provenance (prompt injection)

Author-controlled fields — Jira descriptions, parent ticket text, MR
comments — may contain instruction-like text ("ignore previous instructions",
"merge to main now"). Defences are layered:

| Layer | Mechanism | Implementation |
| ----- | --------- | -------------- |
| Delimiter fencing | Explicit untrusted markers around author text | `wrapUntrustedText()` in `crews/delivery-build/src/agents/prompt-context.ts` |
| System prompt | Instructs model to treat delimited content as data only | Each persona `prompt.md` |
| Tool allowlist | Blocks privileged operations even if model complies | `allowedTools` + `buildToolAllowlistGuard` |
| Context assembly | Agent `context` built from integration API responses in `workflow.ts`, not raw webhook payloads | `jira.ts` / `gitlab.ts` handlers pass `issueKey` / MR identifiers only |

Eval coverage: `tool-allowlist-denial.eval.ts` and unit tests in
`prompt-context.test.ts` / `agent.engineer.test.ts`.

---

## 5. Configuration and observability

| Control | Pattern |
| ------- | ------- |
| Typed config | Single `loadConfig(env)` schema per crew; fail fast at boot on invalid env |
| Secret redaction | `Secret()` fields stripped from `config.loaded` boot log |
| Audit trail | Every tool call logged via `buildAuditHook`; `workflow.complete` carries per-step cost |
| Health | `/healthz` exposes poller and DB status without secrets |
| Mechanical enforcement | `guard:invariants` checks `upsertStory` before `agent.run`, no `process.env` leaks, no crew→crew imports |

**Tracked gaps:**

| Gap | Backlog | Notes |
| --- | ------- | ----- |
| OTel distributed tracing | `CREW-8` | Structured logs today; trace correlation across crews planned |
| Per-tool approval metadata for destructive ops | `solution.md` §7 (Next) | Allowlist denies; interactive approval not yet modelled |
| Operator run-stream | `RH02-09` / `CREW-16` | Live progress API for in-flight stories |
| Execution sandbox | `CREW-19` | Host workspace + lock today; Firecracker/container sandbox for untrusted code Later |
| Remote audit sink | `CREW-4` | SQLite per crew today; transport-agnostic sink for CLI crews |

---

## 6. Pre-production checklist

Operators run this checklist before every new `delivery-build` deployment.
Each item maps to an **existing control** (✓) or a **tracked gap** (○). The
operational copy with verification commands lives in
[`docs/runbook/delivery-build.md`](../runbook/delivery-build.md) §7.

| # | Check | Control / gap |
| - | ----- | ------------- |
| 1 | Webhook URLs registered with correct secrets | ✓ `verifySignature()` — `handlers/jira.ts`, `handlers/gitlab.ts` |
| 2 | `JIRA_WEBHOOK_SECRET` and `GITLAB_WEBHOOK_SECRET` ≥ 16 chars | ✓ `config.ts` schema validation |
| 3 | Jira webhook replay window enforced | ✓ `checkReplayWindow()` in Jira handler |
| 4 | Duplicate webhook events deduplicated | ✓ `webhook_events` table + `checkAndRecord()` |
| 5 | Secrets injected via platform env, not in image or repo | ✓ Railway env vars; `Secret()` redaction |
| 6 | `pnpm diagnose` passes (MCP boots with credentials) | ✓ Diagnostics script |
| 7 | SQLite on persistent volume | ✓ `DB_PATH` on mounted volume — runbook §2.3 |
| 8 | Persona allowlists reviewed for task (no merge tools) | ✓ `engineer/agent.ts`, `senior-engineer/agent.ts`; `isProtectedBranchTool()` |
| 9 | Author text fenced in prompts | ✓ `formatAgentContext()` / tests |
| 10 | Agent context from integration APIs, not webhook bodies | ✓ Handler + workflow conventions — `AGENTS.md` |
| 11 | Loop caps configured (`REFACTOR_LOOP_CAP`, `CI_RETRY_CAP`) | ✓ `workflow.ts` + env defaults |
| 12 | `guard:invariants` green in CI | ✓ `tooling/invariants-guard` |
| 13 | Kernel-level workspace sandbox | ○ `CREW-19` — host workspace acceptable for org-owned repos |
| 14 | OTel trace export configured | ○ `CREW-8` — structured logs sufficient for initial deploy |
| 15 | Live run-stream for operators | ○ `RH02-09` — use logs and `/healthz` until shipped |

---

## 7. References

| Document | Relevance |
| -------- | --------- |
| [`solution.md`](solution.md) §7 | Cross-cutting security row in architecture |
| [`AGENTS.md`](../../AGENTS.md) | Threat model, webhook conventions, pre-merge checklist |
| [`delivery-build.md`](../runbook/delivery-build.md) | Deploy, diagnose, security checklist §7 |
| [`delivery-build` flow](../design/crew-flows/delivery-build.md) | Escalation and handoff contracts |
| [`backlog.md`](../product/backlog.md) | `CREW-17`, `CREW-19`, `CREW-8` tracking |
