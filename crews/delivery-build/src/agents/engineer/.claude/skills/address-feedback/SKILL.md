# Skill: address-feedback

You are running this skill when `context.task === "address-feedback"`.

## Inputs

| Field      | Source                       | Required |
| ---------- | ---------------------------- | -------- |
| `issueKey` | top-level `AgentInput`       | yes      |
| `mrUrl`    | `context`                    | yes      |
| `comments` | `context` (array of strings) | yes      |

The `comments` array contains the blocking findings from the most recent
peer review. Each entry is self-contained — it should describe the file,
the issue, and the remediation.

## Steps

Work findings in order. Do not bundle them; one finding, one change. If a
finding is unactionable (out of scope, unsafe, or contradicts the design),
do not skip it silently — apply the change and document your reasoning in
the reply note, or stop and return a blocker.

### 1. Gather context

Read in order:

1. `mcp__atlassian__jira_get_issue` for `issueKey` — refresh the AC.
2. `mcp__gitlab__get_merge_request` for `mrUrl` — confirm branch, target,
   open state. Note the source branch name; you will push there.
3. `mcp__gitlab__list_merge_request_diffs` — see what currently exists on
   the branch.

### 2. Categorise each finding

For each comment in the `comments` array, in your reasoning, classify:

- **blocker** — security defect, incorrect logic, missing AC coverage,
  missing test for new behaviour. These must be fixed.
- **warning** — non-blocking concern flagged for visibility. Apply the
  change unless it would be wrong.
- **suggestion** — optional improvement. Apply only if low cost and clearly
  correct; otherwise reply to the thread acknowledging and deferring.

If the array is undifferentiated (just blocking comments), treat all as
blockers.

### 3. Apply one fix at a time

For each finding:

1. Identify the file(s) named or implied by the comment.
2. Read each file in full via `mcp__gitlab__get_file_contents` against the
   feature branch. Never modify a file you have not just re-read on the
   branch — the engineer's earlier state is stale.
3. Compose the smallest correct change that addresses the finding. Do not
   touch lines that are not implicated by the finding.
4. Push the change via `mcp__gitlab__push_file`. Commit message:
   `fix(<scope>): <imperative summary>` or `refactor(<scope>): <summary>`.
   Keep one finding per commit so the diff is auditable.

If a fix would break correctness or leave the code in an inconsistent
state, stop after pushing the partial work and return `success: false`
with a precise blocker describing what cannot be fixed.

### 4. Reply to each comment thread

For each finding, post a reply note via `mcp__gitlab__create_note`:

- For accepted findings: state in one or two sentences exactly what
  changed and reference the commit.
- For findings you disagreed with but applied anyway: state your reasoning
  and that you applied the change for safety/consistency.
- For deferred suggestions: acknowledge, state why deferring, and link to
  any follow-up story if one exists.

Replies are short. Reviewers do not need a paragraph; they need confirmation.

### 5. Verify behaviour preserved

Re-read each modified file. Confirm:

- No public API shape changed unless the finding explicitly required it.
- No test was deleted or weakened.
- AC coverage from the original implementation is intact (cross-reference
  the AC list from step 1).
- No unrelated lines moved.

If any of these fail, restore the file and try again.

## Quality rules

- Read every file before modifying it (and re-read if you have already
  modified it in this run — pushes change branch state).
- One finding, one change, one commit.
- Preserve observable behaviour. Refactoring must not alter what the code
  does, only how it does it, unless the finding explicitly flagged a
  logic bug.
- Preserve test coverage. Never delete or weaken a test to silence a
  failure. If a test was wrong, fix the test logic and document why in
  the commit message.
- Code comments explain non-obvious intent. Comments must not cite
  Jira IDs or markdown documents.
- Stay strictly within the named files. Cosmetic edits elsewhere are
  noise that obscures the actual fix.

## Negative constraints

- MUST NOT add new features or expand story scope. Raise a new story
  instead.
- MUST NOT rewrite architectural patterns or cross-cutting concerns.
  Those live in `solution.md` and require an ADR.
- MUST NOT change acceptance criteria or remove tests that cover them.
- MUST NOT suppress findings by leaving them unactioned. If you genuinely
  disagree, reply explaining why and apply the change anyway unless it
  would break correctness.
- MUST NOT push large refactors in response to a small comment.
- MUST NOT post review-style comments on other reviewers' threads. You
  are the addresser, not a reviewer.
- MUST NOT call `mcp__gitlab__create_merge_request` — the MR already
  exists.
- MUST NOT mark `success: true` if any blocking comment was not addressed
  by a commit on the branch.

## Output contract

Return an `AgentResult` with this artefact shape:

```json
{
  "success": true,
  "summary": "Addressed 3 blocking findings on MR !42. 3 commits pushed. Each comment thread has a reply.",
  "artefacts": {
    "commitsPushed": [
      "h7i8j9k fix(auth): validate path against repo root before read",
      "l0m1n2o test(auth): add path-traversal rejection test",
      "p3q4r5s refactor(auth): extract budget enforcement into helper"
    ],
    "findingsAddressed": [
      {
        "category": "blocker",
        "summary": "Path traversal validation missing",
        "commit": "h7i8j9k"
      },
      { "category": "blocker", "summary": "Test for path traversal missing", "commit": "l0m1n2o" },
      {
        "category": "warning",
        "summary": "Budget enforcement inline duplication",
        "commit": "p3q4r5s"
      }
    ],
    "findingsDeferred": []
  },
  "costUsd": 0
}
```

If a finding cannot be addressed safely, return:

```json
{
  "success": false,
  "summary": "Blocked on finding 2: comment requests removing the rate-limit middleware, which would break AC-4. Need clarification.",
  "artefacts": {
    "commitsPushed": ["h7i8j9k fix(auth): validate path against repo root before read"],
    "findingsAddressed": [
      { "category": "blocker", "summary": "Path traversal validation missing", "commit": "h7i8j9k" }
    ],
    "blocker": "Finding 2 conflicts with AC-4 (rate limiting). Cannot apply without breaking the story."
  },
  "costUsd": 0
}
```
