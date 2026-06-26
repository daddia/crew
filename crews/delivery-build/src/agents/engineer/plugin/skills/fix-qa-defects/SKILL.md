# Skill: fix-qa-defects

You are running this skill when `context.task === "fix-qa-defects"`.

## Inputs

| Field            | Source                 | Required |
| ---------------- | ---------------------- | -------- |
| `issueKey`       | top-level `AgentInput` | yes      |
| `mrUrl`          | `context`              | yes      |
| `branchName`     | `context`              | yes      |
| `defectComments` | `context` (string[])   | yes      |

The `defectComments` array contains structured QA defect notes from Jira.
Each entry describes one defect with severity, steps, expected, and observed
behaviour. Work defects in order.

## Steps

### 1. Gather context

Read in order:

1. `mcp__atlassian__jira_get_issue` for `issueKey` — refresh acceptance criteria.
2. `mcp__gitlab__get_merge_request` for `mrUrl` — confirm branch and open state.
3. `mcp__gitlab__list_merge_request_diffs` — see current branch state.

### 2. Fix one defect at a time

For each defect in `defectComments`:

1. Identify the file(s) implicated by the defect description.
2. Read each file in full from the workspace checkout on `context.branchName`.
3. Apply the smallest correct fix that resolves the observed behaviour.
4. Stage and commit with **Bash**:

```bash
git add <paths>
git commit -m "fix(<scope>): <imperative summary>"
git push origin <branch-name>
```

Keep one defect per commit when practical so fixes are auditable.

### 3. Verify

Delegate `pnpm typecheck`, `pnpm test`, and `pnpm lint` via **Task** →
`test-runner` before finishing. If verification fails, fix and push again.

### 4. Summarise on Jira

Post a short Jira comment via `mcp__atlassian__jira_add_comment` listing each
defect ID addressed and the commit that fixed it.

## Quality rules

- Read every file before modifying it.
- Preserve observable behaviour outside the defect scope.
- Never delete or weaken tests to silence failures.
- Stay within defect scope — no new features or refactors.

## Negative constraints

- MUST NOT open a new merge request — the MR already exists.
- MUST NOT mark `success: true` if any blocker defect was not fixed.
- MUST NOT ignore a defect because it seems hard — escalate via
  `success: false` with a precise blocker instead.

## Output contract

Call `submit_result` with this payload shape:

```json
{
  "success": true,
  "summary": "Fixed 2 QA defects on MR !42. 2 commits pushed.",
  "artefacts": {
    "commitsPushed": [
      "a1b2c3d fix(login): redirect to dashboard after auth",
      "e4f5g6h test(login): add regression for empty password"
    ],
    "defectsAddressed": ["DEF-1", "DEF-2"]
  },
  "costUsd": 0
}
```

If a defect cannot be fixed safely:

```json
{
  "success": false,
  "summary": "Blocked on DEF-2: fix requires schema migration outside story scope.",
  "artefacts": {
    "commitsPushed": ["a1b2c3d fix(login): redirect to dashboard after auth"],
    "defectsAddressed": ["DEF-1"],
    "blocker": "DEF-2 requires a database migration not in scope."
  },
  "costUsd": 0
}
```
