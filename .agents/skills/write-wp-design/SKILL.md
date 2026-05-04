---
name: write-wp-design
description: |
  Drafts a work-package design.md in walking-skeleton mode (foundation sprint, 2–4 pages) or TDD mode (sprint 2+, 5–10 pages). Use when the user mentions "design", "TDD", "technical design", "write the design for {epic}", or "how should we implement {story}". Walking-skeleton names the slice, files, and acceptance gates. TDD adds runtime flows, exact signatures, and cross-squad coordination. Do NOT re-narrate solution.md patterns — cite them. Do NOT include business context — use write-product.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
argument-hint: <work-package-path> [--mode walking-skeleton|tdd]
---

# Write Work-Package Design Document

You are a Senior Software Architect writing a sprint-level design document for
a work package. This document is the implementation specification the squad
builds against. It lives at `work/{d}/{wp}/design.md` and sits one level below
the owning domain or product solution document.

The **parent solution** is the solution.md that covers the domain or product
this work package belongs to:

| Work package context          | Parent solution path                   |
| ----------------------------- | -------------------------------------- |
| Under a domain                | `domain/{d}/solution.md`               |
| Under a portfolio sub-product | `product/{p}/architecture/solution.md` |
| Under a single product        | `architecture/solution.md`             |

References to "solution.md" throughout this skill mean the parent solution
for this work package's context.

Mode is passed as `--mode`:

- `--mode walking-skeleton` — Phase 0 / foundation sprint, 2–4 pages. Name the
  one end-to-end slice, list the files shipped, state the acceptance gates.
  Written after the foundation sprint completes or as a planning artefact
  immediately before it starts.
- `--mode tdd` — Sprint 2+, 5–10 pages. Full implementation spec before code.
  References `solution.md` for domain-wide patterns instead of redefining them.

When no `--mode` is provided, ask: "Is this the foundation sprint (walking-skeleton)
or a later sprint (tdd)?"

## Negative constraints

The design.md MUST NOT contain:

- Domain-wide patterns, policies, or decisions already in the parent solution.md
  → cite `solution.md §{N.M}` instead; do not re-narrate
- Business rationale → belongs in `product.md`
- Phase sequencing or epic ordering → belongs in `roadmap.md`
- Story-level acceptance criteria → belongs in this WP's `backlog.md`

**Delete the `DRAFTING AIDE` comment block before saving the output file.**

## Context

<artifacts>
[Provided by the caller:
  Walking-skeleton mode: epic scope, list of stories from the parent backlog.md,
  parent solution.md (for pattern references)
  TDD mode: parent backlog.md (parent epic entry), work/{wp}/design.md context
  (if updating), parent solution.md, parent contracts.md, relevant codebase
  files, Figma link (if applicable)]
</artifacts>

## Steps (walking-skeleton mode)

1. Read the parent solution.md and the parent epic entry in the owning backlog.md
2. Write §1 "The slice" — one paragraph: what end-to-end path the walking skeleton proves
3. Write §2 "Files shipped" — exact paths with NEW/EVOLVE/KEEP labels and one-line descriptions
4. Write §3 "Acceptance gates" — four subsections:
   - §3.1 End-to-end path (the request/response round-trip succeeds)
   - §3.2 Observability hook fires (one trace span, one log line)
   - §3.3 Error path exercised (the typed error surface renders)
   - §3.4 Scaffolds are complete + quality gates (typecheck, unit tests, axe on skeleton)
5. Write §4 "What this WP did NOT deliver" — explicit list for later sprints to read
6. Write §5 "Open questions closed during this sprint" — decisions resolved; capture for domain history
7. Write §6 "Handoff to next WP" — what the next WP can assume is ready
8. **Delete the `DRAFTING AIDE` comment block before saving.**

## Steps (TDD mode)

1. Read all context before writing anything
2. Write §1 "Scope" — in scope, out of scope, capabilities this WP delivers (link to backlog.md stories)
3. Write §2 "Architecture fit" — how this WP plugs into the parent solution.md; cite solution sections inline, do NOT re-narrate
4. Write §3 "Files and components" — new files, modified files, files NOT modified; each with path + purpose
5. Write §4 "Data contracts" — TypeScript signatures, Zod schemas, types introduced; code fences only
6. Write §5 "Runtime view" — 2–4 key scenarios as text flows; focus on the paths debugged at 3am
7. Write §6 "Cross-squad coordination" (omit section if not applicable) — interface boundaries, contracts, contact DRI
8. Write §7 "Error paths" — per `CartMutationErrorCode` (or equivalent), surface-specific treatment
9. Write §8 "Observability" — new trace spans, RED metrics, RUM timings, log lines introduced by this WP
10. Write §9 "Testing strategy" — layer table (unit/integration/e2e/contract/a11y + scope + target)
11. Write §10 "Acceptance gates" — the subset of `solution.md §2.1` quality goals this WP must satisfy
12. Write §11 "Handoff" — what is stable when this WP closes, what comes next
13. Write §12 "Open questions" — unresolved decisions; each with owner and how it blocks
14. **Delete the `DRAFTING AIDE` comment block before saving.**

## Quality rules

- Walking-skeleton: 2–4 pages. TDD: 5–10 pages.
- Every cross-cutting pattern in TDD §7–8 MUST cite `solution.md` by section; do not restate the pattern
- §3 in walking-skeleton must label every file as `NEW`, `EVOLVE`, or `KEEP`
- §4 in walking-skeleton must be an explicit list — omitting an item implies the next sprint can assume it was done
- §4 in TDD must contain only executable code fences — no prose descriptions of shapes
- **Delete the `DRAFTING AIDE` comment block before saving the output file.**

## Output format

Write as a Markdown file with YAML frontmatter, saved as `work/{d}/{wp}/design.md`.

Use `template.md` as your structural scaffold.

<example>
See `examples/walking-skeleton.md` (walking-skeleton mode)
</example>
