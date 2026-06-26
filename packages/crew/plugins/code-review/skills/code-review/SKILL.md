---
name: code-review
description: Code quality review for pre-MR peer review and post-MR review.
tasks:
  - peer-code-review
  - code-review
---

# Skill: code-review

Shared code-quality review skill used by `senior-engineer` (pre-MR peer review)
and the `code-reviewer` CLI crew (post-MR review). The workflow task name
determines which inputs are available — see Inputs below.

You are running this skill when `context.task === "peer-code-review"` (pre-MR)
or `context.task === "code-review"` (post-MR).

This is a **code quality review**. You are checking that the implementation
is correct, secure, well-tested, and consistent with the design. You are
not responsible for validating that all acceptance criteria are met end-to-end
— that is the stakeholder-review step run later by the tech lead. Your focus
is the code itself.

Peer review runs **before the merge request is opened**. The workflow passes
the feature branch name only; there is no MR URL or pre-fetched diff yet.

## Inputs

| Field        | Source                 | Required |
| ------------ | ---------------------- | -------- |
| `issueKey`   | top-level `AgentInput` | yes      |
| `branchName` | `context`              | yes      |

## Steps

Work through these in order. Do not begin commenting until step 4.

### 1. Read the issue

Call `mcp__atlassian__jira_get_issue` for `issueKey`. Extract:

- Title and description.
- Acceptance criteria — as a reference for what the code should do, not
  as an audit checklist (that comes later in stakeholder-review).
- Any constraints on the implementation: performance budgets, NFRs,
  security requirements, design decisions already made.

### 2. Confirm the feature branch

Call `mcp__gitlab__list_branches` and confirm `branchName` exists. If the
branch is missing, stop and return `success: false` with a precise summary.

### 3. Read the design (if linked)

If a design document is referenced, read it via
`mcp__gitlab__get_file_contents`. Note:

- Component and abstraction boundaries the implementation must respect.
- API and contract shapes the code must follow.
- Error-handling strategy.
- Decisions already made — these are not up for re-review.

### 4. Read the branch diff and surrounding code

Call `mcp__gitlab__get_branch_diffs` with:

- `from`: the project's default branch (typically `main`).
- `to`: `branchName`.

Read the diff in full. For files where the diff lacks sufficient context,
fetch the full file on `branchName` via `mcp__gitlab__get_file_contents`.
Pay attention to:

- New public functions, routes, classes, or exports.
- Changes to existing public surfaces.
- New dependencies or imports.
- Configuration, schema, or migration changes.

If the engineer has pushed during this run, call `get_branch_diffs` again for
a fresh view.

### 5. Apply the code-quality rubric

Work each section in order. Skip sections that are not relevant (no DB
changes → skip migrations) but note the skip explicitly.

#### 5.1 Correctness

- Off-by-one errors, null/undefined dereferences, unhandled promise
  rejections.
- Swallowed errors (caught and not surfaced).
- Race conditions around shared state or async sequencing.
- Logic bugs at boundary conditions even when AC doesn't mention them.

#### 5.2 Security

These are **always blockers**:

- Hardcoded secrets, API keys, tokens, or passwords.
- Unvalidated input flowing into a sink (query, path, shell, eval).
- SQL built by string interpolation rather than parameters.
- Missing auth/authorisation checks at a boundary.
- Secrets in logs or error messages.
- Path traversal: file paths from input without normalisation.
- Unsafe shell construction.

#### 5.3 Tests

- Every new public function, route, or boundary must have a test.
- Tests assert observable behaviour, not implementation detail.
- Negative cases covered (invalid input, error paths, boundary conditions).
- Missing tests for new public behaviour are blockers, not suggestions.

#### 5.4 Performance

- N+1 queries inside loops over user data.
- Unbounded loops over user-controlled input.
- Synchronous I/O on hot paths.
- Obvious quadratic-or-worse algorithms over growing data.

Blockers only when the issue specifies a perf budget or the worst case is
clearly unsafe. Otherwise raise as warnings.

#### 5.5 Breaking changes and migrations

- Schema changes have a forward migration.
- Migrations are idempotent and safe on a live system.
- Public API changes are backwards-compatible or version-gated.
- Removed exports are reflected across all callers in the diff.

Unsafe schema or API changes are blockers.

### 6. Compose the verdict

- `success: true` — no blockers. Warnings and suggestions are allowed.
- `success: false` — at least one blocker. Be specific.

Each finding is one comment. Do not bundle unrelated findings. Each must
include: file path and line range, category (`blocker`/`warning`/`suggestion`),
the observed problem with evidence, and the remediation.

Aggregate similar findings that share a single fix. Do not duplicate.

Findings are returned in the JSON output only. The workflow passes blocking
comments to the engineer's `address-feedback` step; there is no MR to post
notes on yet.

## Quality rules

- Every finding has evidence: file, line, observed behaviour.
- Each comment is self-contained.
- Distinguish blocker / warning / suggestion honestly.
- Security defects and missing tests for new public behaviour are always
  blockers.
- Style preferences not encoded in the project's lint config are not
  findings.
- Do not contradict explicit design decisions. Disagreements are
  observations, not blockers.

## Negative constraints

- MUST NOT build or include an AC completion matrix — that is the
  stakeholder-review's responsibility.
- MUST NOT propose features or refactors outside the diff.
- MUST NOT approve in the GitLab UI — the verdict drives the workflow.
  `approve_merge_request` is not in your allowlist.
- MUST NOT change branch state. You are read-only.
- MUST NOT include business or strategic commentary.
- MUST NOT call `mcp__gitlab__create_note`, `mcp__gitlab__get_merge_request`,
  or `mcp__gitlab__list_merge_request_diffs` — no MR exists at this step.
- MUST NOT mark the verdict pass while CI failures are present without
  explicitly accounting for each one (introduced by this branch,
  pre-existing, or known flake).

## Output contract

Call `submit_result` with one of these payload shapes (not JSON in your final message):

Approving (no blockers):

```json
{
  "success": true,
  "summary": "No blocking code issues. Path validation present, tests cover happy and error paths, no security defects. One suggestion to extract a helper.",
  "artefacts": {
    "verdict": "approved",
    "comments": [],
    "suggestions": [
      "src/routes/auth.ts:L60: error message leaks the bcrypt error type. Consider a generic message for the caller."
    ]
  },
  "costUsd": 0
}
```

Requesting changes:

```json
{
  "success": false,
  "summary": "Two blockers: path lookup in router.ts:42 does not validate user input (directory traversal), and the negative test path is missing. Approve after these are addressed.",
  "artefacts": {
    "verdict": "changes-requested",
    "comments": [
      "src/routes/auth.ts:L42 [blocker]: `req.body.path` passed directly to `readFile()` without normalisation. Validate path is inside the project root. This is a directory-traversal sink.",
      "src/routes/auth.test.ts [blocker]: only the happy path is tested. Add tests for invalid credentials, missing fields, and error responses."
    ],
    "suggestions": [
      "src/routes/auth.ts:L60: error message leaks bcrypt error type. Consider a generic message."
    ]
  },
  "costUsd": 0
}
```
