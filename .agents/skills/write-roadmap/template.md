---
type: Roadmap
domain: <!-- domain name, or omit for platform -->
version: '0.1'
owner: <!-- Squad name -->
status: Draft
last_updated: <!-- YYYY-MM-DD -->
parent_product: product/product.md
parent_roadmap: <!-- product/roadmap.md, or omit for platform -->
related:
  - domain/{domain}/product.md
  - domain/{domain}/metrics.md
  - domain/{domain}/requirements.md
  - domain/{domain}/design.md
  - domain/{domain}/contracts.md
  - domain/{domain}/backlog.md
---

<!--
DRAFTING AIDE — DELETE THIS BLOCK BEFORE SAVING THE OUTPUT FILE.
DO NOT INCLUDE in roadmap.md:
  - Epic IDs or story IDs                              → backlog.md
  - Story-level acceptance criteria or deliverable lists → work/{wp}/backlog.md
  - Component names, schemas, or file paths            → solution.md
  - Dates beyond the current "Now" phase               → commitments evaporate; phase gates hold
  - Technical implementation detail                    → solution.md or work/{wp}/design.md
A roadmap entry is: one customer-visible outcome + exit criteria for that phase.
-->

# Roadmap -- {Domain}

## 1. Roadmap intent

<!-- What this roadmap sequences and why phasing matters.
What platform phase does this domain sit in?
What is the non-negotiable constraint (e.g. "no production traffic until baselines captured")? -->

## 2. Sequencing logic

<!-- 3-5 named principles that drive the phase order. Be opinionated.
State the trade-offs explicitly (e.g. "upstream deps run in parallel, not serial"). -->

1.
2.
3.

## 3. Phases

<!-- Repeat this block for each phase. Typical sequence:
Alpha (foundation + internal) → Beta (commercially viable) → Feature-complete → Migration-ready -->

### Phase N -- {Name} ({brief description})

**Objective:** <!-- One sentence: what this phase proves or delivers -->

**Epics:**

- **{EPIC-ID}** -- {title}. {one-sentence scope}.

**Quality gates (cf. `metrics.md`):**

- <!-- metric ID + condition, e.g. "CM-G01 meets target in Lighthouse on seeded data" -->

**Exit criteria:**

- <!-- Specific and testable. Who validates? Under what conditions? -->

**Out of scope for this phase:** <!-- what waits until later -->

## 4. Milestones

| Milestone                      | Phase   | Customer-visible? | Notes |
| ------------------------------ | ------- | ----------------- | ----- |
| <!-- e.g. Alpha on staging --> | Phase 1 | Internal only     |       |

## 5. Cross-domain dependencies

| Dependency                                   | Owner squad    | Gates                       | Current status |
| -------------------------------------------- | -------------- | --------------------------- | -------------- |
| <!-- what this domain needs from another --> | <!-- squad --> | <!-- which phase / epic --> | Not started    |

## 6. Out of scope for this roadmap

<!-- Ideas that are real but deferred out of this cycle. Capture them here so they are not lost.
Per item: name, brief description, deferral reason. -->

## 7. Review cadence

- **Weekly** (during active execution): <!-- what is reviewed, who attends -->
- **Pre-phase-gate:** <!-- who reviews, what metrics are evaluated, go/no-go logged where -->
- **Quarterly:** <!-- roadmap versioning and scope review process -->
