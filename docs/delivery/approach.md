---
type: Approach
version: 1.3.0
status: Current
last_updated: 2026-04-27
---

# Delivery Approach

## In one sentence

> Write enough down to reduce ambiguity before building, build by working the queue, and refine what you wrote based on what you learned.

## The five tracks

Crew follows a multi-track approach to software delivery. **Discovery** runs ahead of **Delivery**, connected through shared artifacts. **Architecture** runs between Strategy and Discovery, translating product direction into structural decisions. **Strategy** upstream and **Refine** downstream close the loop.

```
Strategy > Architecture > Discovery > Delivery > Refine
    ^                                                  |
    +--------------------------------------------------+
```

The tracks are not sequential phases. They run concurrently. While the delivery team builds stories from the current epic, the discovery team defines the next one. Strategy sets direction periodically. Architecture evolves as the system grows. Refine feeds insights back.

| Track | Purpose | Key question | Objective |
|---|---|---|---|
| **Strategy** | Set direction. Define what to build and why. | *What should we build next and why?* | Product vision, roadmap, and priorities are current and aligned. |
| **Architecture** | Define how the system is structured. Resolve consequential technical decisions. | *Is the architecture sound for what we intend to build?* | Solution architecture, tech stack, and ADRs are current and approved. |
| **Discovery** | Understand the work. Define how to build it. | *Is this ready for development?* | Work items meet their Definition of Ready. |
| **Delivery** | Build, review, merge. | *Is this done to standard?* | Work items meet their Definition of Done. |
| **Refine** | Measure, reflect, improve. | *What did we learn and what should change?* | Insights feed back into strategy and discovery. |

### How they connect

Artifacts are the connection between tracks. Each track produces artifacts that the next track consumes. No hand-offs. No message passing. Artifacts carry the signal.

| From | To | Artifact |
|---|---|---|
| Strategy | Architecture | Product priorities, roadmap, backlog, epics |
| Architecture | Discovery | Solution architecture, tech stack, approved ADRs |
| Discovery | Delivery | Requirements, technical designs, ready stories |
| Delivery | Refine | Merged code, review artifacts, delivery metrics |
| Refine | Strategy | Retrospectives, quality metrics, user feedback |

---

## Principles

- **Artifacts first.** Every decision, design, and requirement is captured as a lightweight, reviewable artifact before work begins.
- **Living documents.** No artifact is final. Reality is the authority; artifacts reflect reality and are expected to evolve.
- **Lightweight and disciplined.** Write enough to reduce ambiguity, not so much that the document becomes the project. A 3--5 page requirements doc. A 5--7 page design. A 1--2 page ADR.
- **Quality through refinement.** First drafts are imperfect. The value is in the review-and-refine loop.
- **Discovery stays ahead of delivery.** Delivery never waits for discovery. If it does, the tracks are not running far enough apart.
- **Contracts at the boundaries.** The handoff between tracks is governed by explicit contracts: Definition of Ready from Discovery to Delivery, Definition of Done from Delivery to Refine.

---

## Strategy

### Purpose

Set product direction. Maintain the product vision, roadmap, and priorities so that Discovery always has a clear signal of what matters next.

### When it runs

Periodically -- not every sprint:
- **Project start** -- establish the vision, initial roadmap, and first epics
- **Phase boundaries** -- review and refine based on what was learned
- **Market or priority shifts** -- when external signals require a change in direction

### Activities

| Activity | Output |
|---|---|
| Define product vision and strategy | `docs/product/product.md` |
| Build roadmap | `docs/product/roadmap.md` |
| Define epics | Epic definitions, initial backlogs (`docs/product/backlog.md`) |
| Review and refine | Updated roadmap, revised priorities |

### Gate: Ready for Architecture

An epic is ready to enter Architecture when:
- Epic has a clear scope statement and context
- Initial stories are defined with acceptance criteria
- Priority is set relative to other epics
- Dependencies on other epics are identified

---

## Architecture

### Purpose

Define and maintain the structural foundation the system is built on. Translate product direction into high-level solution design, technology choices, and documented architecture decisions. Architecture produces the structural context that Discovery and Delivery depend on.

Architecture runs at two levels:

- **System level** -- solution architecture, tech stack, and principles that apply across all epics
- **Epic level** -- consequential decisions that must be resolved before discovery can proceed for a given epic

### When it runs

- **Project start** -- establish the solution architecture, tech stack, and initial principles
- **New epic** -- identify and resolve consequential decisions (ADRs) before discovery begins
- **Phase boundaries** -- review and evolve architecture based on what was learned
- **Structural change** -- when a decision with long-term consequences must be made

### Activities

| Activity | Output |
|---|---|
| Define solution architecture | `architecture/solution.md` |
| Define technology stack | `architecture/tech-stack.md` per repo |
| Define architecture principles | `../crew/architecture/principles.md` |
| Identify consequential decisions | Updated ADR register (planned section) |
| Research options and write ADRs | `../crew/architecture/decisions/ADR-####-{title}.md` (Crew), `architecture/decisions/` (portfolio) |
| Review and approve ADRs | ADR status updated to Accepted |

### Gate: Ready for Discovery

An epic is ready to enter Discovery when:
- Solution architecture is current and covers the epic's scope
- Consequential architecture decisions are documented and approved (if applicable)
- Tech stack is defined for any new technology the epic introduces
- Architecture register reflects the current state

---

## Discovery

### Purpose

Understand the work and define how to build it. Take epics from Architecture and produce artifacts that are ready for development: requirements and technical designs.

Discovery fills the delivery queue. Sprint planning, backlog prioritisation, and story ordering happen here. The output is an ordered set of stories under a parent (epic or initiative), each marked "Ready for Development."

### When it runs

Continuously -- always at least one epic ahead of Delivery.

### Steps

Discovery depth scales with the size and risk of the work.

| Step | Activity | Output | Gate |
|---|---|---|---|
| **1. Discover** | Write requirements. Define acceptance criteria, scope (MoSCoW), success metrics. Refine stories. | `work/{product}/{EPIC}/requirements.md`, updated backlog | Requirements reviewed and approved |
| **2. Validate** | Write technical design. Refine stories based on what the design reveals. Mark stories ready. | `work/{product}/{EPIC}/design.md`, updated backlog | Design approved. Stories marked "Ready for Development." |

### Scaling

| Work type | Discovery depth |
|---|---|
| **Epic** | Full: requirements, design |
| **Complex story** | Requirements + design |
| **Standard story** | Requirements or acceptance criteria only |
| **Bug fix** | Reproduction steps and root cause analysis |
| **Tech debt** | Problem statement and proposed approach |

### Gate: Definition of Ready

A work item is ready for Delivery when:
- Requirements document exists and is approved
- Technical design exists and is approved (for epics and complex stories)
- Stories have acceptance criteria, estimates, and are marked "Ready"
- Dependencies are identified and resolved or planned

---

## Delivery

### Purpose

Build, review, and merge. Take work items that are "Ready for Development" and deliver working, reviewed, merged code.

Delivery is a queue processor, not a planner. It picks up the next story in the ordered queue under a defined parent and works through them sequentially. When one story completes (PR merged), it picks up the next. Delivery does not prioritise, re-order, or plan.

### When it runs

Continuously. The delivery workflow processes the queue until it is empty or paused.

### Steps

| Step | Activity | Output | Gate |
|---|---|---|---|
| **1. Implement** | Engineer reads requirements, design, standards, codebase. Writes code and tests. Self-reviews. | Code and tests on a feature branch | Automated quality gates pass (lint, typecheck, tests) |
| **2. Review** | Reviewer checks code against design, standards, and acceptance criteria. Produces structured review artifact. | Review artifact (`work/{product}/{EPIC}/{TASK}/review.md`) | If blocking issues: engineer addresses feedback (loop). If approved: proceed to PR. |
| **3. Pull request** | Engineer creates PR with structured description linking to requirements, design, and review. | PR on target repo | -- |
| **4. PR review** | Architecture compliance, requirements compliance, final code review, stakeholder review via preview. | Reviewer approvals | All required reviewers approve |
| **5. Merge** | Human governance gate. Final approval and merge to main. | Merged code | Human approval required |
| **6. Advance** | Mark story done. Pick up the next story in the queue. | Status transition | -- |

### Gate: Definition of Done

A work item is done when:
- Code implements the acceptance criteria
- Tests pass (unit, integration as applicable)
- Automated quality gates pass (lint, typecheck, test suite)
- Peer code review approved
- PR review approved by all required reviewers
- Code merged to main
- Documentation updated (if behaviour changed)

---

## Refine

### Purpose

Measure what was delivered. Reflect on how it went. Refine the artifacts, the approach, and the priorities. Feed insights back into Strategy and Discovery so the next cycle is better than the last.

### When it runs

- **End of sprint** -- retrospective, metrics review
- **End of epic** -- epic retrospective, artifact refinement
- **End of phase** -- phase review, all foundational artifacts reviewed and evolved

### Activities

| Activity | Output | Frequency |
|---|---|---|
| Delivery metrics (velocity, cycle time, PR merge rate, review churn) | Metrics report | Per sprint |
| Quality metrics (acceptance rate, defect rate, coverage) | Quality report | Per sprint |
| Sprint retrospective | Retrospective artifact | End of sprint |
| Epic retrospective | Epic review artifact | End of epic |
| Artifact refinement (update requirements, designs, standards based on what was learned) | Updated artifacts | End of epic or phase |

### Feedback routing

| Insight type | Routes to |
|---|---|
| Product direction, feature gaps, user needs | **Strategy** |
| Estimation accuracy, discovery gaps, design drift | **Discovery** |
| Code quality patterns, review effectiveness, tooling gaps | **Delivery** |

---

## Why this works for AI-driven delivery

This approach is not just compatible with AI-driven delivery -- it is the natural fit for it.

- **Artifacts are the ideal interface for AI agents.** An LLM reads a requirements document and produces a design. It reads a design and produces code. It reads code and produces a review. The artifact-led model gives each agent exactly what it needs: a clear, structured input and a well-defined output.
- **Contracts govern the handoffs.** The Definition of Ready is the input contract for Delivery. The Definition of Done is the output contract. Contract-driven delivery makes persona boundaries explicit and testable.
- **Refinement corrects imperfection.** AI agents produce good first drafts, not perfect outputs. The review-and-refine loop is the quality mechanism.
- **Short cycles limit blast radius.** If an agent-produced artifact is wrong, only one story of work is affected. The next cycle corrects it.
- **Lightweight artifacts fit context windows.** A 5-page requirements document fits in an LLM context window. A 200-page specification does not.
- **Living documents match stateless execution.** Crew's personas start fresh on every run, reading the current version of artifacts. They don't need to be told what changed -- they read the latest.

---

## Related documents

- [Architecture Principles](../../crew/architecture/principles.md)
- [Solution Architecture](../../crew/architecture/solution.md)
- [Portfolio Product Overview](../docs/product/product.md)
- [Portfolio Roadmap](../docs/product/roadmap.md)
- [Definition of Ready](conventions/definition-of-ready.md)
- [Definition of Done](conventions/definition-of-done.md)
