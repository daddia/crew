# Adding an Agent Crew

An agent crew is a deployable agent service containing two or more personas that hand off work in a defined sequence. The delivery crew (`engineer → senior-engineer → tech-lead`) is the canonical example.

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
cp -r crews/delivery crews/<name>
```

Update `package.json` to set `"name": "@daddia/crew-<name>"`.

`pnpm-workspace.yaml` already globs `crews/*`, so no workspace change is needed. Copy and adapt the delivery crew's `Dockerfile` — the build context must be the workspace root so `packages/*` are available. Add a build and test job for the new crew in the pipeline.

## 3. Directory layout

Each persona gets its own directory under the crew's `agents/` folder:

```
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

`workflow.ts` owns the sequence. The pattern for each phase is:

```typescript
// 1. Record intent before calling the agent (crash-recovery anchor).
state.upsertStory(issueKey, "<phase>");
state.startPhase(issueKey, "<phase>");

// 2. Call the persona with the context it needs.
const result = await <persona>.run({
  ...input,
  context: { task: "<phase>", /* phase-specific data */ },
});

// 3. Record the outcome.
state.finishPhase(issueKey, "<phase>", {
  costUsd: result.costUsd,
  verdict: result.success ? "ok" : "failed",
});

// 4. Escalate or continue.
if (!result.success) {
  await escalateToHumanReview(issueKey, "<reason>", []);
  return;
}
```

Write `state.startPhase` **before** `agent.run()`. This is the crash-recovery anchor: on restart, scan for phases with `started_at` set and `finished_at` null to identify incomplete runs.

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

## 5. Defining phases in state.ts

Add every phase name to the `Phase` union:

```typescript
export type Phase =
  | 'implement'
  | 'open-mr'
  | 'peer-review'
  | 'address-feedback'
  | 'final-review'
  | 'done'
  | 'needs-human-review';
```

Phases must be stable strings — they are stored in SQLite and used for crash-recovery lookups.

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
- [ ] Phase sequence is documented in a comment at the top of `workflow.ts`
- [ ] `Phase` union in `state.ts` covers every phase name used in `workflow.ts`
- [ ] `state.startPhase` is called before every `agent.run()` call
- [ ] Every failure path calls `escalateToHumanReview` and returns — no throws
- [ ] Feedback loops are bounded by a `LOOP_CAP` env var (default `2`)
- [ ] Reviewer and gatekeeper personas have no write tools in `allowedTools`
- [ ] Tool-scoping test added for each persona
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes (no cross-crew imports)
