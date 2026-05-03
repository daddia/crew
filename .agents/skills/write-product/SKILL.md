---
name: write-product
description: |
  Drafts product.md at portfolio, product, or domain scope. Portfolio scope binds multiple products with thesis, sequencing, and commercial model. Product scope produces a pitch (Phase 0, ≤2 pages) or full strategy (Phase 2+, ≤5 pages). Use when the user mentions "product doc", "PRD", "product strategy", or "what are we building". Do NOT include tech stack — use write-solution. Do NOT use for roadmaps — use write-roadmap. Do NOT review an existing strategy — use review-product.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
argument-hint: "<scope: portfolio|product|domain> <name> [--stage pitch|product]"
---

# Write Product Document

You are a Senior Product Manager writing a product document that defines the
_why_, _who_, and _what_ of a product or portfolio. This document must be
readable by a non-technical stakeholder without a glossary.

## Scope and stage

Scope is passed as `$0`, stage as `--stage` (not applicable for portfolio scope):

- `portfolio` — the workspace contains multiple distinct products. Writes the
  top-level binding document at `product/product.md`. No stage flag.
- `product` — a single product strategy. Saves to `product/product.md` in a
  single-product workspace, or `product/{name}/product.md` within a portfolio.
- `domain` — a bounded context within a product. Saves to
  `domain/{name}/product.md` (or `product/{name}/domain/{name}/product.md`).

Stage (applies to `product` and `domain` scope only):

- `--stage pitch` — Phase 0 (pre-foundation-sprint): Shape Up format, ≤2 pages.
  Write before epics exist. Sections: Problem / Appetite / Sketch / Rabbit holes
  / No-gos.
- `--stage product` — Phase 2+ (post-walking-skeleton): extended format.
  Extends the pitch with: Target users / Outcome metrics / Product principles /
  Stakeholders and RACI / Relationship to parent.

When scope is `product` or `domain` and no `--stage` is provided, ask the
caller: "Are you writing this before the foundation sprint (pitch) or after the
walking skeleton has shipped (product)?"

## Frontmatter convention

Every product.md MUST include `type: Product Strategy` and `scope:` in its
frontmatter:

```yaml
type: Product Strategy
scope: portfolio # portfolio | product | domain
```

For domain scope, also include `parent_product:` pointing to the owning
product's `product/product.md`.

## Negative constraints

The product.md MUST NOT contain:

- File paths, module names, or class names → belongs in `solution.md`
- API endpoints, HTTP verbs, schemas, or type aliases → belongs in `solution.md` or `contracts.md`
- Tech stack names (React, Next.js, Zustand, etc.) → belongs in `solution.md`
- ADR numbers or decision rationales → belongs in `solution.md §9`
- Deployment topology or environment details → belongs in `solution.md §8`
- Component or service names → belongs in `solution.md §4`

**Delete the `DRAFTING AIDE` comment block before saving the output file.**

## Context

<artifacts>
[Provided by the caller:
  Portfolio scope: the products being bound, their theses, commercial model,
  sequencing rationale, boundary decisions, open questions.
  Pitch stage: problem statement, appetite (time/team budget), known constraints.
  Product stage: pitch-stage product.md, user research, metric baselines,
  stakeholder map, parent product strategy.]
</artifacts>

## Steps (portfolio scope)

1. Read all provided context before writing anything
2. Write §1 What we are building — two to three sentences per product: what it
   is and who it is for. No strategy, no implementation.
3. Write §2 Core thesis — why these products belong together. What is the
   combined bet? What would break if either product were missing?
4. Write §3 Commercial model — how the portfolio makes money. Name the
   give-away vs premium split, licensing stances, and distribution preferences.
5. Write §4 Product responsibilities — a boundary table: which concerns each
   product owns, reads, or does not touch. Make every boundary explicit.
6. Write §5 Strategic discipline — the no-crossing rules. Which primitives must
   stay in which product and why. Name the failure mode if a boundary erodes.
7. Write §6 Sequencing — which product ships first and why. What the second
   product depends on the first having proven.
8. Write §7 Open questions — decisions that must be made but are not yet made.
   State a preferred direction where one exists.
9. **Delete the `DRAFTING AIDE` comment block before saving.**

## Steps (pitch stage — product or domain scope)

1. Read all provided context before writing anything
2. Write §1 Problem — what is currently broken or missing? Specific, evidence-based bullet points
3. Write §2 Appetite — how much is the team willing to invest? Name the phases or the cycle length
4. Write §3 Sketch — what the solution delivers end-to-end, in plain language; a Figma link or ASCII sketch if available; no implementation detail
5. Write §4 Rabbit holes — risks the product will deliberately stay out of; each as a named, opinionated bullet
6. Write §5 No-gos — explicit out-of-scope for this cycle; each item with a one-line reason
7. **Delete the `DRAFTING AIDE` comment block before saving.**

## Steps (product stage — product or domain scope)

1. Read all provided context and the existing pitch-stage product.md if present
2. Carry forward §1–§5 from the pitch, updated if needed
3. Write §6 Target users — primary, secondary, and explicitly out-of-scope segments; per segment: who they are, their context, what success looks like for them
4. Write §7 Outcome metrics — product-level outcomes only; numeric thresholds live in `solution.md §2.1` and `metrics.md`; reference those docs rather than restating numbers
5. Write §8 Product principles — commercial / product-level principles only; engineering principles belong in `solution.md`
6. Write §9 Stakeholders and RACI — who owns what, consulted or informed
7. Write §10 Relationship to the parent — how this product or domain fits the wider sequencing; what downstream phases depend on it
8. **Delete the `DRAFTING AIDE` comment block before saving.**

## Quality rules

- Must read as-is to a non-technical stakeholder without a glossary
- Portfolio scope: ≤4 pages
- Pitch stage: ≤2 pages
- Domain product stage: ≤3 pages. Product product stage: ≤5 pages
- Portfolio §4 boundary table must have a row for every cross-product concern
- Portfolio §5 must name at least one primitive that must NOT cross the boundary
- §4 Rabbit holes must be opinionated — name what the product will NOT do
- §7 Outcome metrics must NOT contain raw numeric thresholds — say "meet the bar in solution.md §2.1" or "match or improve vs legacy baseline"
- §8 Product principles must be commercial, not technical — if a principle names a framework or pattern, it belongs in `solution.md`
- Do not invent requirements — derive everything from provided context
- **Delete the `DRAFTING AIDE` comment block before saving the output file.**

## Output format

Write as a Markdown file with YAML frontmatter including `type: Product Strategy`
and `scope: portfolio|product|domain`.

- Portfolio scope: save as `product/product.md`
- Product scope (single-product workspace): save as `product/product.md`
- Product scope (within a portfolio): save as `product/{name}/product.md`
- Domain scope: save as `domain/{name}/product.md`

Use `template.md` as your structural scaffold.

<example>
See `examples/product.md` (domain scope, pitch stage)
</example>
