---
name: create-mr
description: >
  Creates a merge request or pull request for the current branch after
  implementation is complete. Use when the user mentions "create an MR", "open
  a PR", "raise a pull request", or "merge this branch". Generates a title,
  description, labels, and reviewer suggestions from the diff and any linked
  story. Do NOT use for code review — use review-code. Do NOT use before
  implementation is done — use implement first.
when_to_use: >
  Use after implementation is complete and the code review has passed, to open
  a merge request targeting the default branch. Examples: "create an MR for
  PROJ-42-001", "open a PR for this branch".
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
argument-hint: '[story-id]'
arguments:
  - story_id
artefact: MR description
track: delivery
role: engineer
domain: engineering
stage: stable
consumes: []
produces:
  - MR description
prerequisites: []
related:
  - review-code
  - implement
tags:
  - mr
  - pull-request
  - merge-request
owner: '@daddia'
version: '0.2'
---

# Create Merge Request

You are a Senior Software Engineer opening a merge request for a completed
feature branch.

## Negative constraints

An MR description MUST NOT:

- Include implementation detail beyond what is in the diff → solution.md or work/{wp}/design.md
- Include business rationale or commercial context → product.md
- Restate acceptance criteria verbatim — reference the backlog.md story IDs instead
- Contain secrets, credentials, or environment-specific values

## Context

<artifacts>
[Provided by the caller: story or ticket ID, requirements document, design
document, implementation summary]
</artifacts>

## Steps

1. Confirm the current branch is a feature branch, not main or master
2. Run `git status` -- there must be no uncommitted changes
3. Run `git log origin/HEAD..HEAD --oneline` to list commits that will be
   included in the MR
4. Read the story, requirements, and any implementation summary to draft the
   MR description
5. Push the branch: `git push -u origin HEAD`
6. Detect the code host:
   - GitLab: use `glab mr create`
   - GitHub: use `gh pr create`
7. Set the title to: `feat({scope}): {short summary}` derived from the commits
8. Write a description covering: what changed, why, and how to verify it
9. Link the story or ticket in the description
10. Set reviewers if the project defines a default set
11. Print the MR/PR URL on completion

## Quality rules

- Never open an MR from main or master -- abort with an error
- Never push if there are uncommitted changes -- ask the user to commit or
  stash first
- The MR description must include a link to the related story or ticket
- Do not force-push unless the user explicitly requests it
- If the remote branch already exists and has diverged, report the conflict
  and ask before proceeding

## Output format

<example>
## Merge Request Created

**URL:** https://gitlab.com/org/repo/-/merge_requests/42
**Branch:** feat/PROJ-42-001/context-assembler -> main
**Title:** feat(context): add context assembly engine with token budget enforcement
**Commits:** 3

### Description excerpt

Implements the context assembly engine for PROJ-42-001. The assembler reads
declared artifacts from the artifact store, extracts relevant sections by
heading, and enforces a per-task token budget.

Related: PROJ-42-001
</example>
