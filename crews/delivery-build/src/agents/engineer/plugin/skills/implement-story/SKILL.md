# Skill: implement-story

You are running this skill when `context.task === "implement-story"`.

## Inputs

| Field                                             | Source                 | Required     |
| ------------------------------------------------- | ---------------------- | ------------ |
| `issueKey`                                        | top-level `AgentInput` | yes          |
| `projectDir`                                      | `context`              | yes          |
| linked design (e.g. design.md path or attachment) | Jira issue body        | when present |

## Steps

Follow these in order. Do not skip ahead. If a step blocks (missing AC, no
design where one is required, ambiguous scope), stop and return
`success: false` with a precise blocker description.

### 1. Read the issue

Call `mcp__atlassian__jira_get_issue` with `issueKey`. Extract:

- Title and summary.
- Description in full.
- Acceptance criteria — each criterion as a discrete item. Look for EARS
  phrasing ("WHEN ... THEN ...") or Gherkin scenarios ("Given/When/Then").
- Linked issues, parents, attachments, and any link to a design document.

If the issue does not have acceptance criteria, stop. Do not proceed
without AC. Return `success: false` with `summary: "AC missing on
<issueKey>"`.

### 2. Read the design (if linked)

If the issue references a design document (often `work/{epic}/design.md`
or an attached file), read it with **Read** from the workspace checkout.
Extract:

- The intended approach and component boundaries.
- API or contract shapes the story is required to implement.
- Data model implications.
- Error-handling strategy.
- Any test strategy notes.

### 3. Explore the codebase

Before writing any code, use **Read** (and **Bash** `ls`/`find` if needed)
to read:

- The repo's `AGENTS.md`, `CLAUDE.md`, or `README.md` for conventions.
- Files you will modify, in full.
- Adjacent files that demonstrate the pattern you should follow (imports,
  naming, error handling, test structure).
- Existing tests in the same module — your new tests must follow the same
  shape.

Pattern continuity beats personal preference. If the codebase uses
`Result<T>` returns, do not introduce thrown exceptions. If the codebase
uses one test framework, do not introduce another.

### 4. Plan the change

In your reasoning, name explicitly:

- The exact list of files you will create or modify with their target
  paths.
- The order of changes (what depends on what).
- Which acceptance criterion each file or function addresses.
- What tests you will add and which AC each test covers.

Do not proceed if you cannot map every AC to a planned change.

### 5. Create the feature branch

Run in **Bash** from the workspace root:

```bash
git checkout main && git pull --ff-only origin main
git checkout -b feature/<issueKey>-<2-4-word-kebab-slug>
```

The slug is derived from the issue title; lowercase; hyphen-separated; do
not duplicate the issue key in the slug. If the branch already exists,
choose a fresh slug or add a numeric suffix.

### 6. Implement file by file

For each file in your plan:

1. **Read** the current contents. (For new files, skip — but you must
   already have surrounding directory context from step 3.)
2. Apply the smallest correct change with **Edit** or **Write**. Preserve
   unrelated lines exactly.
3. Stage and commit with **Bash**:

```bash
git add <paths>
git commit -m "feat(<scope>): <imperative summary>"
```

Keep commits atomic — one logical change per commit including its tests.

### 7. Verify before MR

Invoke the **test-runner** subagent via **Task** to run `pnpm typecheck`,
`pnpm test`, and `pnpm lint`.

- If verification fails, fix the code and re-run test-runner until all
  pass or you cannot proceed (return `success: false` with the failure).
- Record the test-runner output in `artefacts.verificationSummary`.

The workflow opens the MR only after verification passes.

### 8. Push the branch

```bash
git push -u origin <branch-name>
```

### 9. Verify against AC

Re-read the acceptance criteria. For each criterion, identify the file and
test that satisfy it. If any AC is not satisfied by your changes, return
to step 4 and add the missing work.

### 10. Compose the MR description

You will not call any MR-creation tool — the workflow opens the MR using
the artefacts you return. Compose the MR description as part of the
artefact, using the template below.

```markdown
## Summary

{1-2 sentence factual summary of the change.}

## Acceptance Criteria Coverage

| Criterion    | Evidence                                                          |
| ------------ | ----------------------------------------------------------------- |
| {AC summary} | `path/to/file.ts:lineRange` and `path/to/file.test.ts::test name` |

## Verification

{Paste test-runner pass output or summary.}

## Files Changed

- `path/to/file.ts` [created|modified] — {one-line purpose}

## Notes for the reviewer

{Optional: surface any non-obvious decisions, intentional trade-offs, or
open questions. Omit this section if there are none.}

## Related

- Story: {issueKey}
- Design: {path-to-design or "not applicable"}
```

## Quality rules

- Read every file before modifying it.
- Stay strictly within the story scope. No drive-by refactors.
- Every new public function, route, or boundary has a test.
- No secrets, credentials, or environment values committed.
- Commits are atomic and named per the convention.
- Run test-runner before `submit_result` with `success: true`.
- If you cannot complete a step, stop and return `success: false` — never
  fabricate progress.

## Negative constraints

- MUST NOT modify architectural patterns, NFRs, or cross-cutting concerns
  — raise a follow-up story instead.
- MUST NOT introduce public APIs, contract shapes, or schemas not
  specified in the design or in `contracts.md` for the domain.
- MUST NOT perform unsolicited refactoring outside the files named in the
  story.
- MUST NOT commit generated artefacts, build outputs, or unrelated
  lockfile churn.
- MUST NOT skip tests, mark failing tests as expected, or weaken existing
  tests to make a change pass.
- MUST NOT call any merge-request creation tool. The workflow opens the MR
  from the artefacts you return.
- MUST NOT return `success: true` if typecheck, test, or lint failed.

## Output contract

Call `submit_result` with this payload shape (not JSON in your final message):

```json
{
  "success": true,
  "summary": "Implemented POST /auth/login on feature/ENG-123-login-endpoint. Verification passed. Every AC mapped to file and test.",
  "artefacts": {
    "branchName": "feature/ENG-123-login-endpoint",
    "title": "Add login endpoint with bcrypt password check",
    "description": "## Summary\n\n...",
    "verificationSummary": "All verification passed (typecheck, test, lint).",
    "filesChanged": [
      { "path": "src/routes/auth.ts", "status": "created" }
    ],
    "commits": [
      "a1b2c3d feat(auth): add login route with bcrypt verification"
    ]
  },
  "costUsd": 0
}
```

If you cannot complete the work, return:

```json
{
  "success": false,
  "summary": "Blocked: verification failed — pnpm test errors in auth.test.ts",
  "artefacts": {
    "blocker": "pnpm test failed after 3 fix attempts",
    "verificationSummary": "..."
  },
  "costUsd": 0
}
```
