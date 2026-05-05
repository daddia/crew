# Crew Codebase Review

> **Archive.** This review reflects the repository **as of 2026-05-04**, before
> package consolidation ([CREW-56](../work/crew-package/backlog.md)). Paths under
> `packages/sdk`, `packages/contracts`, and `packages/webhooks` now live under
> `packages/crew` (`@daddia/crew`, `@daddia/crew/webhooks`). Where a finding cites
> an old path or package name, map it to the current tree when acting on the
> issue.

### Executive Summary

The architecture is well-conceived: clean dependency boundaries enforced by `dependency-cruiser`, strict TypeScript, good webhook security primitives, a well-structured state machine, and solid test coverage for the orchestration layer. The refactor to `@anthropic-ai/claude-code` as the SDK foundation is the right direction.

The primary concern is that **no agent actually runs**: all four `run()` implementations and `resolveSession()` are explicit stubs that throw or return random UUIDs. Everything downstream of that is production-quality scaffolding waiting for the SDK wire-up. Several secondary issues need addressing before this can go to production.

---

## P0 — Critical / Blocking

### 1. All agent `run()` methods are unimplemented

Every persona (`engineer`, `senior-engineer`, `tech-lead`, `code-quality`) throws at runtime:

```
crews/delivery/src/agents/engineer/agent.ts:44
crews/delivery/src/agents/senior-engineer/agent.ts:44
crews/delivery/src/agents/tech-lead/agent.ts:44
crews/code-reviewer/src/agents/code-quality/agent.ts:42
```

The `AgentDefinition` is constructed correctly (prompt, skills, tools, MCP servers). The missing step is calling the `@anthropic-ai/claude-code` SDK to create a session, run the query, and return a structured `AgentResult`. This is the top priority.

### 2. `resolveSession()` returns a random UUID

```
packages/crew/src/session.ts:33
```

The function never calls the Claude Code SDK. It always returns `crypto.randomUUID()`. There is no session creation, no session resumption. This needs to use the SDK's programmatic API (`query()` or equivalent) and properly handle the `isResumed` path so the engineer's address-feedback loop maintains MR context across turns.

### 3. Code-reviewer Dockerfile installs `pnpm@9` against a pnpm 10 lockfile

```
crews/code-reviewer/Dockerfile:2
```

```dockerfile
RUN npm install -g pnpm@9
```

The workspace `packageManager` is `pnpm@10.33.2` and `pnpm-lock.yaml` was generated with pnpm 10. Running `pnpm install --frozen-lockfile` with pnpm 9 against a v9 lockfile format difference will fail or silently misbehave. The delivery Dockerfile correctly uses `corepack enable` — apply the same pattern:

```dockerfile
RUN corepack enable
```

---

## P1 — High Priority / Security & Reliability

### 4. No CI pipeline

No `.github/workflows/` or equivalent CI config exists. `AGENTS.md` states "CI fails if any is violated" — but there is no CI. `pnpm lint` (dependency-cruiser), `pnpm typecheck`, and `pnpm test` are all currently manual-only. Adding a GitHub Actions workflow running these three commands on every push and pull request is the minimum bar before this repo can accept contributions safely.

### 5. Duplicate SQLite connections to the same file

```
crews/delivery/src/state.ts:39      (createStateStore — opens DB_PATH)
crews/delivery/src/idempotency.ts:10 (getIdempotency — also opens DB_PATH)
packages/crew/src/webhooks/idempotency.ts:30
```

`createStateStore()` opens `DB_PATH` and its schema already creates the `webhook_events` table. `getIdempotency()` opens the same `DB_PATH` path and creates the same `webhook_events` table again via `CREATE TABLE IF NOT EXISTS`. The result is two `DatabaseSync` connections to the same file managing the same table. With WAL mode this won't corrupt, but it wastes a connection and creates confusing dual-ownership. Fix: pass the existing `db` from `createStateStore` to the idempotency logic, or fold `createIdempotencyStore` directly into the state store.

### 6. `finishPhase()` ignores the `phase` argument

```
crews/delivery/src/state.ts:105
```

```typescript
finishPhase(issueKey, phase, { costUsd, verdict }) {
  finishPhaseStmt.run(Date.now(), costUsd ?? null, verdict ?? null, issueKey);
  void phase;   // ← phase is silently discarded
}
```

The `UPDATE` finds the phase by `WHERE issue_key = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1`. If two phases for the same story ever have overlapping execution (e.g., a crash-recovery replay), the wrong row gets finished. The query should be `WHERE issue_key = ? AND phase = ? AND finished_at IS NULL`.

### 7. No startup validation of required environment variables

```
crews/delivery/src/integrations/jira.ts:10
crews/delivery/src/integrations/gitlab.ts:10
crews/delivery/src/index.ts
```

`ATLASSIAN_BASE_URL`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `GITLAB_PERSONAL_ACCESS_TOKEN`, `ANTHROPIC_API_KEY` all silently default to `""`. A misconfigured deployment will start successfully and only fail when the first workflow runs, making debugging harder. Add an eager validation block to `index.ts`:

```typescript
const required = ['ANTHROPIC_API_KEY', 'ATLASSIAN_BASE_URL', 'ATLASSIAN_EMAIL',
                  'ATLASSIAN_API_TOKEN', 'GITLAB_PERSONAL_ACCESS_TOKEN',
                  'JIRA_WEBHOOK_SECRET', 'GITLAB_WEBHOOK_SECRET'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) { log.error('server.missing-env', { missing }); process.exit(1); }
```

### 8. No workflow crash recovery

```
crews/delivery/src/handlers/jira.ts:52
crews/delivery/src/handlers/gitlab.ts:54
```

Both handlers use `setImmediate()` fire-and-forget. If the server restarts while a workflow is mid-flight, the in-progress story is silently abandoned. The `phases` table already records `started_at`/`finished_at` pairs that can detect this: rows with `started_at IS NOT NULL AND finished_at IS NULL` are interrupted phases. A startup recovery scan over these rows (or a persistent job queue like BullMQ/pg-boss) would prevent silent story loss.

### 9. MCP server versions are unpinned in `mcp.json`

```
crews/delivery/mcp.json
crews/code-reviewer/mcp.json
```

```json
"args": ["-y", "@anthropic-ai/mcp-server-gitlab"]
```

`npx -y` downloads the latest version on every agent invocation. A breaking change in `mcp-server-gitlab` or `mcp-server-atlassian` will silently break all agents in production. Pin to a specific version: `"@anthropic-ai/mcp-server-gitlab@1.2.3"`.

### 10. `createMr()` has no idempotency guard

```
crews/delivery/src/integrations/gitlab.ts:44
crews/delivery/src/workflow.ts:42
```

If the workflow crashes after MR creation but before `finishPhase("open-mr")` records the verdict, a replay will call `createMr()` again and create a duplicate MR on the same branch (which will 422 or create a second MR on a different branch). Fix by calling `GET /merge_requests?source_branch=<branchName>` before `POST /merge_requests` and returning the existing MR URL if found.

---

## P2 — Medium Priority / Architecture & Code Quality

### 11. AGENTS.md package names diverge from the implementation

```
AGENTS.md lines 43–55
```

The documentation consistently refers to `@org/sdk`, `@org/contracts`, `@org/webhooks`, `@org/agent-delivery`. **Update (post-CREW-56):** `AGENTS.md` now documents `@daddia/crew`, `@daddia/crew/webhooks`, and the `@daddia/agent-*` units. At review time, aligning docs with published names was still open.

### 12. `subagentPaths` is loaded but has no consumption path

```
packages/crew/src/loaders.ts:27
packages/crew/src/agent.ts (AgentDefinition.subagentPaths)
```

Every persona builds an `AgentDefinition` with `subagentPaths`, but there is no code anywhere that reads these paths and passes subagent definitions to the Claude SDK session. When wiring `run()`, make sure `subagentPaths` are read and injected as subagent system prompts (or equivalent Claude Code SDK concept) — otherwise all that `.claude/agents/` discovery work is dead weight.

### 13. Test mock `makeState()` has a spurious `db` property

```
crews/delivery/tests/workflow.test.ts:36
crews/delivery/tests/handlers.jira.test.ts:27
```

```typescript
return {
  ...
  close: vi.fn(),
  db: {} as never,   // ← not in StateStore interface
};
```

`StateStore` has no `db` member. TypeScript strict mode will emit an excess-property error on this literal. Remove `db: {} as never` from both test helpers. If the production store ever needs to expose `db` (e.g., for the idempotency consolidation in #5), add it to the interface first.

### 14. Unused tooling configurations

```
tooling/eslint-config/nest.js
tooling/eslint-config/next.js
tooling/eslint-config/react-internal.js
tooling/typescript-config/nestjs.json
tooling/typescript-config/nextjs.json
tooling/typescript-config/react-library.json
tooling/tailwind-config/
```

This is a backend-only Node.js monorepo. Seven config files for NestJS, Next.js, React, and Tailwind are unused. They add cognitive noise and a maintenance surface area (dependency updates) for zero benefit. Delete them, along with the corresponding `devDependencies` in `tooling/eslint-config/package.json`.

### 15. `esbuild` in `pnpm-workspace.yaml` is unused

```
pnpm-workspace.yaml:6
```

`allowBuilds: esbuild: true` permits native binary compilation for esbuild, but no package in the repo uses esbuild as a build tool (all packages use `tsc`). Remove the entry.

### 16. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "0"` is unexplained

```
.claude/settings.json
```

This disables the experimental agent teams feature in the project's Claude Code config. This may be intentional (preventing the Claude Code CLI from auto-wiring agent teams when a developer runs it in the repo root), but it contradicts the multi-persona architecture and deserves a comment explaining why it's off, or removal if it serves no purpose.

### 17. Auth header is constructed eagerly at module load in `integrations/jira.ts`

```
crews/delivery/src/integrations/jira.ts:14
```

```typescript
const authHeader = "Basic " + Buffer.from(`${EMAIL}:${API_TOKEN}`).toString("base64");
```

This runs at import time before any env var validation (see #7). If `EMAIL` or `API_TOKEN` are empty, a Base64 of `:` is silently baked in. Move the header construction inside `jiraFetch()` so it can fail loudly once startup validation is in place.

### 18. GitLab `extractMrIid()` is fragile for cross-project MR URLs

```
crews/delivery/src/integrations/gitlab.ts:74
```

```typescript
const match = webUrl.match(/\/merge_requests\/(\d+)/);
```

This regex works for standard GitLab URLs but will silently extract the wrong IID if the URL format changes (e.g., subgroups, custom domains). Pair it with validation that the extracted project path matches `GITLAB_PROJECT_ID`, or pass the IID as a typed field on the MR object rather than re-extracting it from URLs.

---

## P3 — Low Priority / Enhancements

### 19. No distributed tracing

`observability.ts` emits structured JSON logs. For a multi-phase, multi-agent workflow — where a single story may span 7 phases, 3 personas, and 30+ MCP tool calls — logs alone are insufficient for post-mortem debugging. Add OpenTelemetry traces with spans per phase and per agent invocation. The `phaseRow.sessionId` field is the right correlation handle.

### 20. No rate limiting on webhook endpoints

The Hono server has no rate limiting. Signature verification protects against unauthorized callers, but a flood of valid webhooks (Jira thrashing status transitions) could queue hundreds of concurrent workflows against the same SQLite DB. Add a simple in-memory rate limiter (or Hono middleware) keyed on `issueKey`.

### 21. Missing `.env.example` for agents

```
.env.example (root level only)
```

The root `.env.example` only documents `ANTHROPIC_API_KEY`. Neither `crews/delivery/.env.example` nor `crews/code-reviewer/.env.example` exists, leaving contributors to discover required vars from source code. Add per-agent example files documenting every required and optional env var with descriptions.

### 22. `pnpm-lock.yaml` is excluded from Dockerfile `COPY`

```
crews/code-reviewer/Dockerfile:13
crews/delivery/Dockerfile:12
```

Both use `pnpm-lock.yaml*` (glob with optional suffix). This is defensive coding for the case where no lockfile exists, but with `--frozen-lockfile` a missing lockfile is a hard error anyway. Removing the glob and using a plain `COPY pnpm-lock.yaml ./` makes the intent explicit and prevents the layer from silently installing without a lockfile.

### 23. `workflow.ts` loop bound is off-by-one in documentation

```
crews/delivery/src/workflow.ts:55
```

The loop runs `for (let iteration = 0; iteration < REFACTOR_LOOP_CAP + 1; iteration++)`. With `REFACTOR_LOOP_CAP=2`, this allows 3 peer-review calls (iterations 0, 1, 2) but only 2 address-feedback calls (the check `if (iteration >= REFACTOR_LOOP_CAP) break` prevents the third). The test in `workflow.test.ts` correctly documents `cap + 1` senior-engineer calls, but AGENTS.md says "The cap applies to both the internal peer-review loop and the external-comment path" without specifying the asymmetry. Clarify the semantics in a comment.

### 24. Turbo has no remote cache

```
turbo.json
```

Turbo is configured but uses local cache only. For team builds and CI, configuring a remote cache (Vercel, Turborepo Cloud, or self-hosted) would make CI meaningfully faster as the `packages/crew` build artifacts are stable between most PRs.

### 25. `getMrDiff()` fetches the full diff without pagination

```
crews/delivery/src/integrations/gitlab.ts:59
```

`GET /merge_requests/:iid/diffs` returns all diffs in one call. For large MRs this can be a multi-MB response that gets passed directly into the agent context. Add a file-count guard (similar to `code-reviewer`'s `diffFileCap`) and a total diff size cap before feeding to the agent.

---

## Priority Matrix

| # | Issue | Effort | Impact |
|---|---|---|---|
| 1–2 | Wire agent `run()` + `resolveSession()` | High | P0 — system is inert without this |
| 3 | Fix code-reviewer Dockerfile pnpm version | Low | P0 — build fails |
| 4 | Add CI pipeline | Medium | P1 — no safety net |
| 5 | Consolidate dual SQLite connections | Low | P1 — architectural confusion |
| 6 | Fix `finishPhase()` ignoring `phase` param | Low | P1 — wrong row updated under replay |
| 7 | Startup env validation | Low | P1 — silent misconfig |
| 8 | Workflow crash recovery | High | P1 — story loss on restart |
| 9 | Pin MCP server versions | Low | P1 — silent prod breakage |
| 10 | `createMr()` idempotency | Medium | P1 — duplicate MRs |
| 11 | Fix AGENTS.md package names | Low | P2 — contributor confusion |
| 12 | Wire `subagentPaths` in SDK session | Medium | P2 — dead code path |
| 13 | Remove spurious `db` from test mocks | Low | P2 — type error |
| 14–15 | Delete unused tooling + esbuild entry | Low | P2 — maintenance noise |
| 16–18 | Settings comment, auth header, MR IID | Low | P2 — correctness/clarity |
| 19–25 | Tracing, rate limiting, env examples, etc. | Various | P3 — hardening |

The most valuable next step is implementing `resolveSession()` and the four `run()` methods in `packages/crew/src/session.ts` and each `agent.ts` — everything else is scaffolding that works correctly once the SDK calls are live.
