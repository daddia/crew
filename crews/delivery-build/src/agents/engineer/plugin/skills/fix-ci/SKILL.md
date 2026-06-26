# Skill: fix-ci

You are running this skill when `context.task === "fix-ci"`.

Your job is to diagnose and fix CI failures on an open merge request. The
workflow has already confirmed the pipeline failed; you push corrective
commits to the MR's source branch so the next pipeline run can pass.

## Inputs

| Field        | Source                       | Required |
| ------------ | ---------------------------- | -------- |
| `issueKey`   | top-level `AgentInput`       | yes      |
| `mrUrl`      | `context`                    | yes      |
| `branchName` | `context` (MR source branch) | yes      |

## Steps

Follow these in order. If you cannot determine the failure or apply a safe
fix, stop and return `success: false` with a precise blocker.

### 1. Gather context

Read in order:

1. `mcp__atlassian__jira_get_issue` for `issueKey` — refresh the AC and
   scope. Do not expand scope beyond the story.
2. `mcp__gitlab__get_merge_request` for `mrUrl` — confirm branch, target,
   open state, and pipeline status metadata. Note the source branch name;
   you will push there.
3. `mcp__gitlab__list_merge_request_diffs` — see what currently exists on
   the branch.

### 2. Diagnose the failure

From the MR metadata and diff, infer the most likely CI failure:

- Lint or format errors — read the named files and fix style violations.
- Type errors — read the named files and correct types or imports.
- Test failures — read the failing test and implementation files named in
  the change set; fix the smallest correct change.
- Missing files or broken imports introduced by the branch.

You do not have pipeline job logs. Use MR pipeline status, commit messages,
and the diff to form a hypothesis. If the failure mode is ambiguous and you
cannot fix without guessing, return `success: false` with the blocker.

### 3. Apply one fix at a time

For each corrective change:

1. Identify the file(s) implicated by the failure.
2. Read each file in full with **Read** from the workspace checkout on the
   MR source branch (`context.branchName`).
3. Compose the smallest correct change that addresses the CI failure using
   **Edit** or **Write**.
4. Commit and push with **Bash**:

```bash
git add <paths>
git commit -m "fix(<scope>): <imperative summary>"
git push origin <branch-name>
```

One logical fix per commit. Re-run the **test-runner** subagent via **Task**
after fixes when feasible.

If a fix would break correctness or leave the code inconsistent, stop after
pushing partial work and return `success: false` with a precise blocker.

### 4. Verify locally (reasoning only)

Re-read each modified file. Confirm:

- No public API shape changed unless the failure explicitly required it.
- No test was deleted or weakened.
- Story AC coverage from the original implementation is intact.
- No unrelated lines moved.

### 5. Summarise for the workflow

State which files changed, which failure class you addressed, and that new
commits were pushed to the MR branch. The workflow will re-poll the pipeline.

## Quality rules

- Read every file before modifying it.
- One failure class, one commit when possible.
- Preserve observable behaviour. Fix the CI failure, not unrelated style.
- Preserve test coverage. Never delete or weaken a test to silence CI.
- Code comments explain non-obvious intent. Comments must not cite Jira IDs
  or markdown documents.
- Stay strictly within files implicated by the CI failure.

## Negative constraints

- MUST NOT add new features or expand story scope.
- MUST NOT rewrite architectural patterns or cross-cutting concerns.
- MUST NOT push to `main` or any protected branch.
- MUST NOT call `mcp__gitlab__create_merge_request` — the MR already exists.
- MUST NOT merge the MR.
- MUST NOT mark `success: true` if no corrective commit was pushed and the
  failure remains unaddressed.

## Output contract

Call `submit_result` with this payload shape (not JSON in your final message):

```json
{
  "success": true,
  "summary": "Fixed lint failure in src/auth.ts on MR !42. 1 commit pushed.",
  "artefacts": {
    "commitsPushed": ["a1b2c3d fix(auth): satisfy eslint no-unused-vars"],
    "failureClass": "lint",
    "filesChanged": ["src/auth.ts"]
  },
  "costUsd": 0
}
```

If the failure cannot be diagnosed or fixed safely, return:

```json
{
  "success": false,
  "summary": "Pipeline failed but MR metadata does not indicate which job failed. Cannot fix without pipeline logs.",
  "artefacts": {
    "commitsPushed": [],
    "blocker": "Ambiguous CI failure — need pipeline job output to proceed."
  },
  "costUsd": 0
}
```
