---
name: write-solution
description: |
  Drafts solution.md in stub mode (Phase 0, two sections) or full arc42-lite mode (Phase 2+, ten sections). Use when the user mentions "solution design", "architecture", "how will this work", or "what should we build". Stub mode produces a Phase 0 anchor with [NEEDS CLARIFICATION] placeholders; full mode reverse-engineers the architecture from a shipped walking skeleton. Do NOT use for business strategy — use write-product. Do NOT use for sprint TDD — use write-wp-design.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
argument-hint: "<scope: portfolio|product|domain> <name> [--stage stub|full]"
---

# Write Solution Document

You are a Senior Solution Architect writing a solution design that makes the
architecture of a domain legible to engineers, adjacent squads, and AI agents.

Scope is passed as `$0`, stage as `--stage`:

- `portfolio` — cross-product solution overview (`architecture/solution.md`)
- `product <name>` — single-product solution (in portfolio: `product/{name}/architecture/solution.md`; in single-product workspace: `architecture/solution.md`)
- `domain <name>` — domain-scoped solution (`domain/{name}/solution.md`)

Stage:

- `--stage stub` — Phase 0 (pre-foundation-sprint): fill §1 and §2 only;
  scaffold §3–11 as `[NEEDS CLARIFICATION]`. Target ≤2 pages.
- `--stage full` — Phase 2+ (post-walking-skeleton): fill all eleven sections
  from the context provided. Target 8–12 pages.

## Negative constraints

The solution.md MUST NOT contain:

- Commercial rationale or business case → belongs in `product.md`
- Target customer segments or personas → belongs in `product.md`
- Strategic thesis or product principles → belongs in `product.md`
- Positioning or messaging → belongs in `product.md`
- User quotes → belongs in `product.md`
- Story-level acceptance criteria → belongs in `work/{wp}/backlog.md`
- Phase sequencing or epic ordering → belongs in `roadmap.md`

## Context

<artifacts>
[Provided by the caller:
  Stub stage: product.md, architecture principles, known system boundary
  Full stage: product.md, work/{wp}/design.md (walking-skeleton), emergent ADRs,
  contracts.md, metrics.md]
</artifacts>

## Steps (stub stage)

1. Read product.md and any architecture principles provided
2. Write §1 "Context and scope" — system boundary, C4 Level 1 diagram (ASCII),
   what this domain owns vs does not own, upstream/downstream systems
3. Write §2 "Quality goals and constraints" — top 3–5 NFRs ordered by priority,
   org / regulatory / technical constraints
4. Scaffold §3–11 as headings with `[NEEDS CLARIFICATION]`
5. Add §11 "Graduation candidates" heading with `[NEEDS CLARIFICATION]`
6. **Delete the `<!-- DO NOT INCLUDE -->` comment block from the output before saving.**

## Steps (full stage)

1. Read all provided context before writing anything
2. Write §1 Context and scope — system boundary, C4 L1, upstream/downstream
3. Write §2 Quality goals and constraints — ordered NFRs, constraints
4. Write §3 Solution strategy — architectural style, key tech choices (3–6 principles), how each satisfies a quality goal
5. Write §4 Building block view — C4 L2 (containers), selectively L3 (components), module/directory layout
6. Write §5 Runtime view — 2–5 key sequences as text flows or ASCII diagrams (favour the scenarios debugged at 3am)
7. Write §6 Data model and ubiquitous language — entities, relationships, invariants, glossary
8. Write §7 Cross-cutting concepts — observability, error taxonomy, security, feature flags, caching, a11y, testing strategy
9. Write §8 Deployment and environments — topology, CI/CD, rollout pattern
10. Write §9 Architectural decisions — MADR/Nygard entries or links; mark candidates as "_(Not yet written)_"
11. Write §10 Risks, technical debt, open questions
12. Write §11 Graduation candidates — patterns that should lift to `architecture/patterns/` when a second domain adopts them
13. **Delete the `<!-- DO NOT INCLUDE -->` comment block from the output before saving.**

## Quality rules

- §1 must include a text-based system-context diagram (C4 L1) — no images
- §3 must name the trade-offs, not just the choices
- §9 candidate ADRs must carry a "_(Not yet written)_" marker; do not invent ADR bodies
- §11 must state the trigger for graduation, not just the pattern name
- Every cross-cutting pattern in §7 must reference a domain behaviour, not just name a tool
- Full stage: 8–12 pages. Stub stage: ≤2 pages.
- Do not repeat business context from product.md — reference it with a link
- **Delete the `<!-- DO NOT INCLUDE -->` comment block before saving the output file.** It is a drafting aide only; it must not appear in the committed document.

## Output format

Write as a Markdown file with YAML frontmatter.

| Scope                                    | Save path                                 |
| ---------------------------------------- | ----------------------------------------- |
| `portfolio`                              | `architecture/solution.md`                |
| `product` (single-product workspace)     | `architecture/solution.md`                |
| `product <name>` (portfolio sub-product) | `product/{name}/architecture/solution.md` |
| `domain <name>`                          | `domain/{name}/solution.md`               |

Use `template.md` as your structural scaffold.

<example>
See `examples/solution.md` (domain scope, stub mode)
</example>
