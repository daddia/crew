# Guiding Principles

These principles guide how Crew is designed, built, and operated. They establish the constraints and priorities that shape both the platform runtime and the agentic-first delivery model that runs on top of it. Product strategy ([`docs/product/product.md`](../docs/product/product.md)) and solution architecture ([`architecture/solution.md`](solution.md)) operationalise these principles in product and runtime decisions respectively.

## Agentic-first process

- **Artefacts are the source of truth.** If it isn't in the artefact, it isn't agreed. Decisions, scope, and acceptance criteria live in the document -- not in chat, memory, or oral handoff. Agents read artefacts to know what to do; humans read them to verify what was done.

- **Humans own gates.** Every approval, kill/advance decision, and merge is a named human action. Agents propose, draft, and validate; humans decide and accept. Gates are explicit checkpoints in the workflow -- never implied by silence.

- **Agents own first drafts.** No human writes from a blank page. Every design doc, backlog entry, code change, review comment, and runbook begins as an agent draft. Humans edit and approve; they don't author from scratch.

- **Validate before build.** Evidence kills bad ideas cheap; sprints kill them expensive. Discovery, walking-skeleton designs, and prototypes precede committed delivery. The cost of a wrong direction is paid in days at the start, not in weeks at the end.

- **Small slices, fast signals.** Ship the smallest thing that proves the outcome, then iterate. Walking skeletons before TDD. End-to-end before complete. Feedback loops are measured in hours, not weeks.

## Crew design and operation

- **Specialised by design.** One crew, one step, one purpose. No crew spans a track or owns work across phases. Composition is event-driven across the catalogue; specialisation is preserved as the platform grows.

- **Context is seeded, not remembered.** Every crew reads what it needs at start; nothing is assumed or carried over from a previous run. Memory is an artefact retrieved deliberately, not state held in process. A crew that loses its session loses nothing important.

- **Resolve ambiguity before acting.** Clarifying questions are raised at context-seed time, not mid-implementation. If a story is unclear, the crew escalates to a human and pauses -- it never guesses. Ambiguity surfaces early, or it surfaces as a defect.

- **Stateless by default.** Crews complete their task, hand off, and stop. No polling for completion, no waiting on external systems, no hanging context across reruns. Server-shaped crews hold only what they need for crash recovery; everything else lives in the system of record.

- **Orchestrators poll, agents don't.** Schedulers, webhooks, and pipelines trigger crews; agents never wait on infrastructure. The pattern scales: an orchestrator above the crew is replaceable; a crew that polls is rewritten.

- **Deterministic toolchain first.** CI, SAST, unit tests, linters, and type checks run before agents touch a review. Don't spend tokens on what a tool can catch. Determinism is cheaper than reasoning, every time.

- **Bounded everything.** Every loop has a cap, every external call a timeout, every run a cost ceiling. Unbounded automation is unbounded spend and unbounded risk. Escalation to a human is always cheaper than an unattended runaway.

- **The audit trail is the product.** Every action a crew takes is reconstructible after the fact from logs, state, and step records -- without consulting the operator. Accountability requires visibility; visibility is non-negotiable.

- **Entry and exit conditions are explicit.** A crew that doesn't know when it's done isn't a crew, it's a loop. Every workflow defines its entry signal, its acceptance criteria, and its exit transition -- written, testable, and inspectable from outside the crew.

## Governance

- **Architectural changes** require Solution Architecture ([`architecture/solution.md`](solution.md)) approval
- **Principle updates** require explicit revision of this document; not changeable by inference
- **Implementation variations** documented in the relevant work-package design (`docs/work/{wp}/design.md`)
- **Quarterly review** to assess principle effectiveness as the catalogue grows
