---
type: Architecture Decision Record (ADR)
status: Proposed
date: 2026-06-26
supersedes:
related:
  - docs/architecture/solution.md §4.4
  - docs/architecture/solution.md §10.3 (open question #7)
  - docs/work/TASKS.md (RH02-12)
  - CREW-20
---

# ADR-0001 — Turn-level checkpointing for in-run tool replay

## Context

Crew durability is layered (`solution.md` §4.4). **Workflow** recovery (per-crew SQLite
`stories` / `steps`) and **session** resume (`resolveSession` + SDK `resume: sessionId`,
compaction via RH02-08) cover story boundaries and context overflow. Neither prevents
wasted or unsafe **turn** replay when a long `implement-story` run crashes mid-session:
completed tool calls may run again, duplicating side effects (Bash, Write, MCP writes) or
burning budget on idempotent reads.

CREW-20 must pick a durability engine before the Future cross-crew orchestrator (CREW-13)
depends on multi-hour persona steps. RH02-12 compares options; implementation is out of
scope for RH02.

**Problem statement.** After a process crash inside a single persona session, resume should
continue from the last durable checkpoint without re-executing completed tool work, while
preserving audit and operator visibility (run-stream, `buildAuditHook`).

## Decision

**Recommend a phased Crew-owned checkpoint log (Option C), layered on existing SDK session
resume (Option B), with explicit tool replay policy — not an external workflow engine
(Option A) for CREW-20.**

CREW-20 should:

1. **Persist incrementally** — extend the per-crew SQLite store (or a dedicated
   `@daddia/crew/checkpoint` subpath) with a `tool_checkpoints` table keyed by
   `(issueKey, sessionId, seq)` recording PostToolUse events already captured by
   `buildAuditHook` / `createRunStreamBridge`: tool name, input hash, output snapshot,
   timestamp, and verdict.
2. **Resume via SDK session ID** — keep `resolveSession(..., previousSessionId)` as the
   conversation continuity path; compaction (RH02-08) remains the context-overflow path,
   not a crash-recovery substitute.
3. **Classify tools for replay** — on resume, **read-only** tools (Read, diff/list MCP)
   may be skipped when a matching checkpoint exists; **mutating** tools (Write, Edit, Bash,
   MCP writes) require idempotency keys or workspace reconciliation (git status vs last
   checkpoint) before skip-or-replay.
4. **Defer external orchestrators** — Temporal/Inngest-style step stores are reserved for
   CREW-13 pipeline suspend/resume across crews, not in-run tool granularity.

Option C fits Crew's thesis: harness-owned policy above the model, no new managed
dependency, graduation path from `delivery-build` SQLite to `@daddia/crew/checkpoint` when
a second crew needs the same schema (`solution.md` §11).

## Consequences

- **Benefit:** Mid-crash resume avoids redundant tool spend and reduces duplicate-write
  risk without waiting on SDK roadmap.
- **Benefit:** Reuses audit hook and run-stream data shapes; operators see the same events
  whether live or replayed from checkpoint.
- **Trade-off:** Crew owns replay semantics and tool classification — not fully general.
- **Trade-off:** Checkpoint storage grows with long runs; retention policy (per story,
  TTL) is required.
- **Trade-off:** SDK session resume alone remains necessary but insufficient; dual paths
  must be tested together.

## Confirmation

CREW-20 implementation is validated when:

1. A fixture `implement-story` run records N tool checkpoints, the process is killed
   mid-session, and resume completes without re-invoking tools classified as replay-safe.
2. A mutating-tool crash scenario either reconciles workspace state or escalates to human
   review rather than silent duplicate writes.
3. Run-stream and audit trail reflect resumed checkpoints in order with `issueKey` and
   `sessionId` correlation.
4. `pnpm guard:invariants` enforces checkpoint write ordering (persist before acknowledging
   tool completion to the model) once hooks land.

## Alternatives considered

### A — Workflow-style step store (Temporal, Inngest, etc.)

Durable activities with automatic retry and exactly-once semantics. **Rejected for CREW-20**
because it adds ops surface and couples in-run tool replay to pipeline orchestration;
appropriate for CREW-13 cross-crew suspend/resume, not single-persona `implement-story`
loops. Cost and deployment model conflict with independently deployable crews.

### B — SDK-native resume extensions only

Rely on Claude Agent SDK `resume: sessionId` (and future SDK checkpoint APIs) to restore
conversation and tool state without Crew persistence. **Rejected as sole path** because
side-effect idempotency is undefined at the SDK boundary today; compaction preserves
context but does not record which Bash/MCP calls completed. **Retained as a layer** —
conversation state stays SDK-owned; Crew adds tool-outcome durability the SDK does not
guarantee.

### C — Crew-owned checkpoint log (recommended)

Thin append-only log via existing PostToolUse hook, crew SQLite, replay policy in
`resolveSession` resume path. **Chosen** for CREW-20: smallest increment aligned with
`StateStore`, audit trail, and run-stream; no external service.

### D — Workspace-only reconciliation (git tree as source of truth)

On crash, inspect branch/filesystem and prompt the model with a summary of done work;
no per-tool log. **Rejected as primary** because it cannot skip expensive read/MCP calls
or prove tool ordering; useful as a **complement** for mutating-tool safety (Option C +
git status check).

---

_Target: RH02-12 spike. Implementation tracked under CREW-20._
