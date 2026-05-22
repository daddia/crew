# Adding an Agent Crew

An agent crew is a deployable agent service containing two or more personas that hand off work in a defined sequence. The `delivery-build` crew (`engineer → senior-engineer`) is the canonical reference layout; the planned `delivery-review` crew (`tech-lead + product-manager (HITL)`) is its smaller sibling.

Use an agent crew when:

- the workflow has distinct phases with different authority or skill requirements (implement, review, approve);
- no single persona should both produce and gate output (separation of concerns);
- a bounded feedback loop needs a separate actor to address and re-review.

Use a solo persona (see `adding-a-persona.md`) when a crew does one job end-to-end with no internal handoff.

## 1. Design the team

Before writing code, define the roster in terms of phases, not job titles.

| Question                               | Example answer                                            |
| -------------------------------------- | --------------------------------------------------------- |
| What phases does the workflow have?    | implement → peer-review → address-feedback → final-review |
| Which phase requires read/write tools? | implement, address-feedback                               |
| Which phase requires read-only tools?  | peer-review, final-review                                 |
| Which persona owns the feedback loop?  | the same persona that implemented (engineer)              |
| Which persona is the final gate?       | a separate, senior persona (tech-lead)                    |

Keep the roster minimal. A two-persona team (producer + gatekeeper) covers most workflows.

## 2. Scaffold the crew

```bash
cp -r crews/delivery-build crews/<name>
```

Update `package.json` to set `"name": "@daddia/crew-<name>"` and reset the version.

`pnpm-workspace.yaml` already globs `crews/*`, so no workspace change is needed. Copy and adapt the `delivery-build` `Dockerfile` — the build context must be the workspace root so `packages/*` are available. Add a build and test job for the new crew in CI.

## 3. Directory layout

Each persona gets its own directory under the crew's `agents/` folder:

```text
crews/<crew>/src/
  agents/
    <producer>/
      agent.ts           # exports const <producer>: Agent
      prompt.md          # role, responsibilities, constraints — no code
      .claude/
        skills/          # SKILL.md files loaded via readSkillsDir()
        agents/          # subagent .md files loaded via readSubagentsDir()
    <reviewer>/
      agent.ts
      prompt.md
      .claude/
        skills/
    <gatekeeper>/
      agent.ts
      prompt.md
      .claude/
        skills/
  workflow.ts             # the only file that knows the full sequence
  state.ts                # Phase type lists every phase in the workflow
```

Only `workflow.ts` imports persona modules. Personas never import each other. Crews must not import from each other — only `packages/*` are shared. Run `pnpm lint` to verify the boundary is clean from day one.

## 4. Write the workflow

**Option A — use `createWorkflowEngine()`** (recommended for new crews):

```typescript
import { createWorkflowEngine } from '@daddia/crew/workflow';
import type { WorkflowPlan } from '@daddia/crew/workflow';

const engine = createWorkflowEngine({
  store,
  logger: log,
  async onEscalate(issueKey, step, reason) {
    await commentOnIssue(issueKey, `Escalating at ${step}: ${reason}`);
    await transitionIssue(issueKey, 'Needs human review');
  },
});

const plan: WorkflowPlan = {
  issueKey,
  steps: [
    { name: 'implement', agent: engineer },
    { name: 'peer-review', agent: seniorEngineer, onFailure: 'continue' },
    { name: 'address-feedback', agent: engineer },
    { name: 'open-mr', agent: engineer },
  ],
};

await engine.run(plan, { task: issueKey });
```

The engine writes `upsertStory` + `startStep` / `finishStep` for you, accumulates step artefacts into a shared context, and calls `onEscalate` on failure.

**Option B — hand-roll the sequence** (the current `delivery-build` pattern; valid but verbose):

```typescript
// 1. Record intent before calling the agent (crash-recovery anchor).
state.upsertStory(issueKey, 'implement');

// 2. Call the persona.
const result = await engineer.run({ ...input, context: { task: 'implement' } });

// 3. Record the outcome.
state.startStep(issueKey, 'implement', result.artefacts?.sessionId);
state.finishStep(issueKey, 'implement', {
  costUsd: result.costUsd,
  verdict: result.success ? 'ok' : 'failed',
});

// 4. Escalate or continue.
if (!result.success) {
  await escalateToHumanReview(issueKey, 'implement failed', []);
  return;
}
```

Write `state.upsertStory` **before** `agent.run()`. This is the crash-recovery anchor: on restart, scan for stories whose `current_step` has no matching finished `steps` row to identify incomplete runs.

### Feedback loops

When a reviewer can send work back to the producer, use a bounded loop:

```typescript
for (let i = 0; i < LOOP_CAP + 1; i++) {
  const reviewResult = await reviewer.run({ ...input, context: { task: "review", ... } });
  if (reviewResult.success) { reviewPassed = true; break; }
  if (i >= LOOP_CAP) { break; }  // cap check before running producer again
  await producer.run({ ...input, context: { task: "address-feedback", ... } });
}

if (!reviewPassed) {
  await escalateToHumanReview(issueKey, "Loop cap reached", unresolvedItems);
  return;
}
```

Bind the cap to an env var (`LOOP_CAP`, default `2`) so it can be tuned without a deploy.

### Escalation

Every failure and every loop-cap breach must call `commentOnIssue` and `transitionIssue("Needs human review")` before returning. Never let the workflow throw to its caller.

## 5. Setting up state.ts

Import `createSqliteStateStore` from `@daddia/crew/state` — it provisions the standard three-table schema (`stories`, `steps`, `webhook_events`), configures WAL mode, and enforces the crash-recovery conventions automatically. Your crew's `state.ts` is the initialisation point, not a schema definition:

```typescript
import { createSqliteStateStore } from '@daddia/crew/state';
import type { StateStore } from '@daddia/crew/state';

export type Step =
  | 'implement'
  | 'open-mr'
  | 'peer-review'
  | 'address-feedback'
  | 'final-review'
  | 'done'
  | 'needs-human-review';

export function createStore(dbPath: string): StateStore {
  return createSqliteStateStore(dbPath);
}
```

Export a `Step` union that lists every step name the workflow uses. Step values are stable strings stored in SQLite and used for crash-recovery lookups — never rename them without a migration.

## 6. Context passed between phases

Each persona receives only what it needs for its phase. Pass context explicitly in the `context` field of `AgentInput`:

| Phase            | Typical context keys        |
| ---------------- | --------------------------- |
| implement        | `task`, `issueKey`          |
| open-mr          | `branchName`, `title`       |
| peer-review      | `task`, `mrUrl`, `diff`     |
| address-feedback | `task`, `mrUrl`, `comments` |
| final-review     | `task`, `mrUrl`             |

Never pass a persona's full result object to the next persona. Extract only what is needed.

## 7. Tool scoping

Each persona must declare a minimal `allowedTools` list. A reviewer should have no write tools. A gatekeeper that only reads diffs and approves MRs should not have Jira write access. Use `buildAuditHook()` from `@daddia/crew` to enforce the allowlist at runtime as a second layer.

## Checklist

- [ ] `package.json` name is `@daddia/crew-<name>`
- [ ] `Dockerfile` builds from workspace root
- [ ] Step sequence is documented in a comment at the top of `workflow.ts`
- [ ] `Step` union in `state.ts` covers every step name used in `workflow.ts`
- [ ] `state.ts` uses `createSqliteStateStore()` from `@daddia/crew/state`
- [ ] `state.upsertStory` is called before every `agent.run()` call
- [ ] Every failure path calls `escalateToHumanReview` and returns — no throws
- [ ] Feedback loops are bounded by a `LOOP_CAP` env var (default `2`)
- [ ] Reviewer and gatekeeper personas have no write tools in `allowedTools`
- [ ] Tool-scoping test added for each persona
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes (no cross-crew imports)
