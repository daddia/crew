# Skill: implement-story

You are running this skill when `context.task === "implement-story"`.

## Inputs

| Field | Source | Required |
|---|---|---|
| `issueKey` | top-level `AgentInput` | yes |
| linked design (e.g. design.md path or attachment) | Jira issue body | when present |

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
or an attached file), read it via `mcp__gitlab__get_file_contents`.
Extract:

- The intended approach and component boundaries.
- API or contract shapes the story is required to implement.
- Data model implications.
- Error-handling strategy.
- Any test strategy notes.

### 3. Explore the codebase

Before writing any code, use `mcp__gitlab__get_file_contents` and
`mcp__gitlab__list_branches` to read:

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

Call `mcp__gitlab__create_branch` with:

- `branch_name`: `feature/<issueKey>-<2-4-word-kebab-slug>`. The slug is
  derived from the issue title; lowercase; hyphen-separated; do not include
  the issue key in the slug.
- `ref`: the project's default branch (typically `main`).

If the branch already exists, choose a fresh slug or add a numeric suffix
rather than reusing or overwriting.

### 6. Implement file by file

For each file in your plan:

1. Read the current contents via `mcp__gitlab__get_file_contents`. (For new
   files, skip this read — but you must already have the surrounding
   directory context from step 3.)
2. Compose the full new file contents in your working memory. Apply the
   smallest correct change. Preserve unrelated lines exactly.
3. Push via `mcp__gitlab__push_file`. The commit message must follow
   `feat(<scope>): <imperative summary>` (or `fix`, `test`, `refactor`).
   Keep commits atomic — one logical change per commit. Do not bundle
   unrelated edits.

Group test files with the code they cover (one commit per logical change,
including its tests).

### 7. Verify against AC

Re-read the acceptance criteria. For each criterion, identify the file and
test that satisfy it. If any AC is not satisfied by your changes, return
to step 4 and add the missing work.

### 8. Compose the MR description

You will not call the `create_merge_request` tool — the workflow does that
using the artefacts you return. Compose the MR description as part of the
artefact, using the template below.

```markdown
## Summary

{1-2 sentence factual summary of the change.}

## Acceptance Criteria Coverage

| Criterion | Evidence |
|---|---|
| {AC summary} | `path/to/file.ts:lineRange` and `path/to/file.test.ts::test name` |

## Files Changed

- `path/to/file.ts` [created|modified] — {one-line purpose}

## Notes for the reviewer

{Optional: surface any non-obvious decisions, intentional trade-offs, or
open questions. Omit this section if there are none.}

## Related

- Story: {issueKey}
- Design: {path-to-design or "not applicable"}
```

The description must be specific, free of marketing language, and contain
no business or strategic commentary. It must not reference any Jira ID
inside the code itself; only here in the description.

## Quality rules

- Read every file before modifying it.
- Stay strictly within the story scope. No drive-by refactors.
- Every new public function, route, or boundary has a test.
- No secrets, credentials, or environment values committed.
- Commits are atomic and named per the convention.
- Code comments explain non-obvious intent. Comments must not cite
  external markdown documents, ticket IDs, or cross-repo paths.
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
- MUST NOT call `mcp__gitlab__create_merge_request`. The workflow opens
  the MR from the artefacts you return.

## Output contract

Return an `AgentResult` with this artefact shape:

```json
{
  "success": true,
  "summary": "Implemented POST /auth/login on feature/ENG-123-login-endpoint. 4 commits, 6 files. Every AC mapped to file and test.",
  "artefacts": {
    "branchName": "feature/ENG-123-login-endpoint",
    "title": "Add login endpoint with bcrypt password check",
    "description": "## Summary\n\nImplements POST /auth/login...\n\n## Acceptance Criteria Coverage\n\n| Criterion | Evidence |\n|---|---|\n| User can log in with valid credentials | `src/routes/auth.ts:L12-L40` and `src/routes/auth.test.ts::accepts valid login` |\n...",
    "filesChanged": [
      { "path": "src/routes/auth.ts", "status": "created" },
      { "path": "src/routes/auth.test.ts", "status": "created" }
    ],
    "commits": [
      "a1b2c3d feat(auth): add login route with bcrypt verification",
      "d4e5f6g test(auth): cover valid and invalid credential paths"
    ]
  },
  "costUsd": 0
}
```

If you cannot complete the work, return:

```json
{
  "success": false,
  "summary": "Blocked: AC-3 references a JWT signing key with no source. Need clarification before proceeding.",
  "artefacts": {
    "blocker": "AC-3 references a JWT signing key path that does not exist in config. Need product/architect input."
  },
  "costUsd": 0
}
```
