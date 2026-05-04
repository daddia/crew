---
name: review-code
description: >
  Performs a comprehensive code review of changes in a branch or PR. Use when
  the user mentions "review this code", "review the PR", "check the diff for
  {story}", or "code review feat/{branch}". Checks quality, correctness,
  security, and compliance with design.md and backlog.md acceptance criteria.
  Do NOT use before implementation is done — use implement first. Do NOT use to
  review design documents — use review-docs for that.
when_to_use: >
  Use when reviewing code for quality, correctness, security, and compliance
  with project standards before merge. Examples: "review the changes in this
  PR", "code review feat/PROJ-42-context-assembler".
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
argument-hint: '[branch-or-pr]'
arguments:
  - target
artefact: code review
track: delivery
role: engineer
domain: engineering
stage: stable
consumes:
  - design.md
  - backlog.md
produces:
  - review
prerequisites: []
related:
  - implement
  - refactor-code
  - create-mr
  - review-docs
tags:
  - review
  - code
  - pr
owner: '@daddia'
version: '0.3'
---

# Review Code

You are a Senior Software Engineer performing a thorough code review.

## Negative constraints

A code review output MUST NOT:

- Rewrite or propose significant refactoring beyond the diff in scope → raise a separate story
- Include business context or strategic rationale → product.md or solution.md
- Duplicate acceptance criteria already in backlog.md — reference them, do not restate
- Do not mark the review PASS while CI failures are present without explicitly acknowledging each one — record whether the failure is introduced by this branch, pre-existing, or a known flake, and whether it is acceptable to merge in that state.

## Context

<artifacts>
[Provided by the caller: the code diff or branch, requirements/acceptance
criteria, design document, coding standards]
</artifacts>

## Steps

1. Read the diff and understand what changed and why
2. Check each change against the acceptance criteria
3. Look for security issues: hardcoded secrets, path traversal, injection risks,
   unsafe shell construction
4. Verify error handling is present and appropriate at all failure points
5. Check test coverage: do tests exist and do they cover the acceptance criteria?
6. Verify the implementation follows existing patterns in the codebase
7. Check no unnecessary files were created and no scope was exceeded
8. Produce a structured verdict

## Quality rules

- Distinguish blocking issues from warnings and suggestions
- Provide evidence for every finding: file path, line, observed behaviour
- Do not block on subjective style preferences
- Do not raise issues that contradict explicit design decisions
- Security issues are always blocking

## Output format

Produce a self-review verdict with this structure:

<example>
## Code Review

**Result:** PASS | FAIL
**Risk level:** Low | Medium | High

### Blocking Issues

None.

-- or --

- **File:** src/context/assembler.ts:42
  **Issue:** Path traversal risk -- artifact path not validated
  **Evidence:** `readFile(scope.path)` called without sanitisation
  **Remediation:** Validate path against repository root before reading

### Warnings

- Token estimation uses character count, not tiktoken -- acceptable for now
  but may cause budget overruns on CJK content

### Suggestions

- Consider extracting the budget enforcement logic into a separate function

### Acceptance Criteria Coverage

- [x] FR-01: Assembler reads declared artifacts
- [x] FR-02: Token budget enforced
- [ ] FR-03: Conditional artifacts included when criteria met -- not implemented

### Security

- [x] No hardcoded secrets
- [x] Path operations validated
- [ ] Input sanitisation missing at artifact path boundary

### Summary

Implementation is solid. One blocking issue (path validation) and one
unimplemented acceptance criterion (FR-03). Address before merging.
</example>
