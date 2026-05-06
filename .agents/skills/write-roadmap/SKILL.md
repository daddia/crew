---
name: write-roadmap
description: |
  Drafts roadmap.md at portfolio, product, or domain scope using outcome-based phases with exit criteria, not epic lists. Portfolio scope sequences multiple products; product scope phases a single product; domain scope phases a bounded context. Use when the user mentions "write the roadmap for {name}", "create the delivery roadmap", or "sequence the phases". Do NOT use to list epics — use write-backlog. Do NOT use before product.md exists — use write-product first.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
argument-hint: "<scope: portfolio|product|domain> [<name>]"
---

# Write Delivery Roadmap

You are a Senior Delivery Lead writing a phased delivery roadmap that
sequences products or epics against a product strategy.

Scope is passed as `$0`:

- `portfolio` — a combined roadmap binding multiple products (`product/roadmap.md`)
- `product` — a single-product roadmap (`product/roadmap.md` or `product/{name}/roadmap.md`)
- `domain` — a domain roadmap (`domain/{name}/roadmap.md`)

## Negative constraints

roadmap.md MUST NOT contain:

- Story-level acceptance criteria or epic detail → belongs in `backlog.md`
- Implementation patterns, tech stack, or module names → belongs in `solution.md`
- Business strategy or commercial model → belongs in `product.md`
- Metrics definitions or baselines → belongs in `metrics.md`

## Context

<artifacts>
[Provided by the caller:
  Portfolio scope: portfolio product.md (thesis, sequencing rationale), each
  product's product.md (status, phase), cross-product dependencies.
  Product/domain scope: product.md (problem, thesis, scope, success
  definition), backlog.md (epic list with dependencies), metrics.md (quality
  gates), cross-squad dependency context.]
</artifacts>

## Steps (portfolio scope)

1. Read the portfolio product.md and each per-product product.md before writing
2. Define the sequencing logic — why the products ship in this order; what the
   first product must prove before the second can depend on it
3. Define 2-5 portfolio phases, each with:
   - Name and objective (one sentence)
   - Which product(s) are in flight
   - What this phase proves or unlocks for the portfolio
   - Exit criteria (specific and testable)
4. Map cross-product dependencies: what product B depends on product A having
   shipped; name the dependency and the gate
5. List items explicitly deferred beyond this roadmap cycle

## Steps (product or domain scope)

1. Read the product.md and backlog.md before writing anything
2. Define the roadmap intent — what this roadmap sequences and why phasing matters
3. Articulate 3-5 sequencing principles that drive the phase order (e.g.
   foundation before features, prove pipeline early, upstream deps in parallel)
4. Define each phase:
   - Name and objective (one sentence)
   - Epics included (reference backlog IDs)
   - Quality gates (reference metric IDs from metrics.md)
   - Exit criteria (specific, testable — not "feels complete")
   - What is explicitly out of scope for this phase
5. Build a milestones table: milestone, phase, customer-visibility, notes
6. Map cross-domain dependencies: what this domain needs from others, who owns
   it, what it gates, current status
7. List items explicitly deferred out of this roadmap cycle
8. Define the review cadence: weekly, pre-phase-gate, quarterly

## Quality rules

- Every phase must have named exit criteria — no subjective gates
- Product/domain: every quality gate must reference a metric ID from metrics.md
- Product/domain: every cross-domain dependency must have a named owner squad
- No phase can have exit criteria that depend on work not assigned to any epic
- Phases must be sequential; parallelism lives within phases, not between them
- Portfolio scope: 2-4 pages. Product/domain scope: 5-8 pages.

## Output format

Write as a Markdown file with YAML frontmatter.

- Portfolio scope: save as `product/roadmap.md`
- Product scope (single-product workspace): save as `product/roadmap.md`
- Product scope (within a portfolio): save as `product/{name}/roadmap.md`
- Domain scope: save as `domain/{name}/roadmap.md`

Use `template.md` as your structural scaffold.
