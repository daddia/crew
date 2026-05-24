---
type: Product Strategy
scope: product
version: '3.0'
owner: daddia
status: Current
last_updated: 2026-05-24
---

# Product -- Crew

## 1. Problem

Knowledge work is the largest category of human labour that has never been industrialised. Manufacturing got assembly lines a century ago; logistics got containers in the 1950s; software delivery got continuous integration in the 2010s. The long tail of multi-step, judgement-laden, artefact-producing work that powers every modern company — engineering, product, operations, research, support — has been waiting for its substrate. Frontier AI models have, for the first time, made the underlying tasks technically feasible to automate. The substrate to run that automation unsupervised, at known cost, accountable to humans, does not yet exist.

The market today has hundreds of agent frameworks, a handful of point demos, and almost no production agent teams. The reason is not the model — it is everything around the model.

- **The model is the engine, not the car.** A frontier model can plan and execute a task. It cannot, on its own, pick the work up, manage a session, route to the cheapest provider that meets the quality bar, hand off cleanly when it is out of its depth, or leave an audit trail a reviewer can trust. Those are platform problems, and no future model release will solve them.
- **Building one agent team is hard; operating one is harder.** Every team that ships an agent today reinvents session management, idempotency, state, escalation, and cost ceilings. The output is a fragile one-off that breaks on the second restart.
- **Scaling past one is reinvention.** A second agent workflow repeats the same infrastructure work and learns none of the operational lessons from the first. Without a substrate, every crew is built in isolation; the catalogue never compounds.
- **Trust requires legibility.** Most agent systems have no bounded loops, no clean escalation path, and no audit trail. Without those, no serious operator will let the system touch real work — and demo-grade is where most of the market sits.
- **Coordination across crews is unsolved.** Once two or more crews exist, the bottleneck moves to composing them — pipelines that survive failures, fan out, and pause for a human without losing state. Event glue gets you the first crew; it does not get you a catalogue.
- **A better foundation model does not produce a platform.** Orchestration, governance, memory across runs, evidence, and cost routing compound where the model alone cannot. The model raises the ceiling on a single call; the platform raises the floor for every call, forever.

The opportunity is the substrate, not another framework. The first team to ship a runtime that makes autonomous agent crews safe to run unattended, easy to deploy, and cheaper with use will own the layer that every later vertical sits on.

## 2. Appetite

Crew is a multi-year platform bet, not a sprint. The work is sequenced across four phases — **prove, harden, scale, compose** — and a phase opens only when the previous phase exits cleanly. Calendar dates are not committed at the strategy layer; the active phase, its capabilities, and its exit criteria live in [`roadmap.md`](roadmap.md).

The investment shape is the same across every phase: ship the most demanding workload first to validate the substrate, then reuse the substrate to widen the catalogue, then make the catalogue compose. We are willing to defer breadth in exchange for proof that the platform compounds — because compounding is the entire commercial bet.

## 3. Sketch

**Crew is the runtime and catalogue for autonomous knowledge work agent crews.**

A *crew* is a small team of specialised AI personas — engineer, senior engineer, technical writer, product manager, architect, reviewer — that executes a defined workflow end-to-end on real work. A crew picks the work up, executes each step in sequence, peer-reviews its own output, opens an artefact for human approval, addresses feedback, and closes the loop. Each crew has one definition of done and one place it hands off when it is out of its depth.

Each crew is **independently deployable**. There is no monolith. A crew runs as its own service with its own state, its own integrations, and its own working hours. Crews do not share memory and do not message each other directly; they converge on versioned artefacts, the same way human teams do. This is what makes a catalogue possible without making it brittle.

Every crew is built on a **shared substrate** that absorbs the parts every crew needs — running safely on real tenants, recovering from failures, staying within cost ceilings, leaving evidence a reviewer can trust, handing off cleanly when confidence runs out. A new crew is *workflow plus personas plus prompts*; everything operational is inherited. The first crew is expensive to build; the tenth is a question of intent.

Above the substrate sits a **compounding surface** that makes every run cheaper and more accurate than the last. Project memory reduces re-prompting cost. Cross-run evidence trains evaluation policy. Model routing picks the cheapest provider that meets the quality bar per task. Specialist optimisers read accumulated outcomes and propose changes the runtime can adopt without redeploying any crew. A foundation model raises the ceiling on a single call; the compounding surface raises the floor for every call, permanently. This is where the commercial defensibility lives — accumulated working knowledge that no model vendor can reach.

Crews read from the projects they operate on through a **minimum workspace contract**: a product strategy, a solution architecture, and a roadmap at known locations. These steering documents are the source of truth the agents work from; they are what makes autonomy possible without surprise. If a steering document is missing, the crew escalates rather than guesses.

In the long horizon, individual crews become **composable steps** in larger pipelines. A coordination layer above the crew triggers one crew when another finishes, fans out from a single event, pauses on a human decision, and resumes exactly where it stopped. Crews stay independently deployable; orchestration connects them without coupling them. This is what turns a catalogue into a platform.

The vision, stated plainly: **anything a small team does repeatedly with a defined workflow and a definition of done can be run by a crew.** Software delivery is the first proof point because it is the most demanding workload — multi-persona, external integrations, bounded feedback loops, human gates. Every later vertical inherits a runtime that has already paid for the hard parts.

## 4. Rabbit holes

- **Building a general-purpose agent framework.** Crew is a runtime and deployment layer on top of an agent SDK, not a replacement for one. Model selection, prompt orchestration internals, and tool-call semantics belong to the SDK and the model provider; Crew commits to staying SDK-agnostic and provider-agnostic above that line.
- **Owning the operator's workspace.** Crew reads from artefact-centric workspaces it does not own — product docs, designs, conventions, program mirrors. The workspace contract defines the minimum surface a project must provide; workspace tooling, scaffolders, and skill libraries are a different product.
- **Making every step autonomous.** Escalation is a feature, not a failure mode. Crews handle what they handle well and hand the rest off cleanly. Forcing autonomy past confidence is how trust collapses — and trust is the harder thing to recover.
- **One platform, every deployment shape.** Multi-region, multi-tenant, and exotic deployment patterns are deferred until the simplest deployment shape is proven across multiple crews. Distribution complexity early is the surest way to ship nothing.
- **Shipping every integration.** Each crew owns the integrations it needs. The platform provides the pattern and the security primitives, not an integration catalogue.
- **Conversational multi-agent graphs.** Personas converge through versioned artefacts, not message passing. There is no shared agent memory and no cross-persona chat state. The model loop is fast; the artefact loop is auditable.
- **Browser-based governance UI.** Steering happens by editing strategy artefacts and approving outputs in the systems of record. A bespoke admin UI is not on the roadmap.

## 5. No-gos

- **Replacing the foundation model or the agent SDK.** Crew is a runtime layer, not a model layer; this is a permanent boundary.
- **Workflows requiring real-time human collaboration mid-run.** Crews offer clean handoff points, not interactive sessions; work that needs a human in the loop continuously is not crew-shaped work.
- **A single run touching multiple repositories, organisations, or security boundaries.** One tenant per run. Anything else is a different product.
- **Stories or tasks with no definition of done.** Without an exit condition, a crew cannot close the loop and will burn budget indefinitely.
- **Compliance-driven environments requiring multi-reviewer change-advisory chains inside every artefact.** Crew is designed for teams that trust autonomous operation within configured bounds; the platform respects bounds, but does not replace them.

## 6. Target users

**Primary — small engineering teams running structured backlogs.** They have established coding standards, an existing codebase with patterns, a passing test suite, and a backlog of well-specified stories. They want delivery throughput without growing headcount. They review merged work after the fact rather than in advance. Success: stories merge while they sleep; the audit trail tells them what happened and why.

**Primary — operators of repetitive knowledge work beyond delivery.** Teams that run a consistent multi-step workflow — code review, documentation, release notes, customer-issue triage, discovery, refinement — and want it to run autonomously, on schedule or on event. They care about cost per run and autonomy rate. Success: the workflow runs overnight; they review the output in the morning and move on.

**Secondary — technical leaders evaluating autonomous knowledge work for a larger organisation.** They want to redirect headcount away from rote work toward higher-leverage work. They care about cost per accepted artefact, escalation rate, and audit quality as management metrics — and about risk exposure, compliance posture, and whether the platform compounds value independently of any single model vendor. They set policy, review weekly summaries, and make the build-vs-buy decision.

**Aspirational — any team with a defined, repeatable workflow and a definition of done.** The long-term target is the broad middle of knowledge work — operations, finance, research, support, internal IT — wherever a multi-step process is run by humans today and could be run by a crew with humans setting policy and reviewing outcomes. The platform earns the right to reach this audience by proving the substrate on the most demanding workload first.

**Out of scope — enterprises with mandatory multi-reviewer approval chains or change advisory boards.** Crew is designed for teams that trust autonomous operation within configured bounds.

**Out of scope — greenfield teams with no patterns or test suite.** Personas need something reliable to read from; without a substrate of conventions, the system has no anchor.

## 7. Outcome metrics

Crew is evaluated on three levels. This document names the outcomes; numeric thresholds and benchmark methodology live in CrewBench (Confluence).

**Platform level — applies to every crew.**

- **Autonomy rate.** Share of runs completed without human intervention. The primary signal of platform health. Stable or trending up at maturity; a declining trend signals degrading input quality or runtime regression.
- **Cost per accepted artefact.** Total spend divided by outputs accepted by humans or downstream gates. The primary commercial metric and the wedge against running a raw model or point agent on the same work. Must be lower than the equivalent manual cost, and trending down as the compounding surface matures.
- **Time to a new crew.** For a new domain, how long from blank slate to a deployed, running crew. The leverage signal — proof that the substrate is doing its job. Target: measured in hours or days, not weeks.
- **Audit completeness.** Share of runs reconstructible from the audit trail without consulting the operator. The trust metric. Target: complete coverage — the audit trail is the product; partial coverage is a defect, not a trade-off.

**Vertical level — delivery first; every later vertical inherits the shape.**

- **Cycle time end to end.** Trigger to accepted output. For delivery: story pickup to merged change. Baseline established on the first vertical; improvement expected as memory and routing land.
- **Escalation rate.** Share of runs that hand off to a human. Stable or trending down at maturity; spiking means the runtime or the input has degraded.
- **Recall across runs.** Share of recurring context retrieved correctly from prior runs without re-prompting. Compounds as project memory and cross-run learning land. Near zero at launch; trending up is the compounding proof.

**Long-term — the platform thesis.**

- **Cost-and-recall trajectory.** Cost per accepted artefact trending down and recall trending up after the compounding surface lands. The proof that the platform improves with use, independently of any single model release.
- **Catalogue breadth.** Number of independently deployable crews running real workloads. The signal that the substrate has earned its name.
- **Share of recurring knowledge work that runs unattended.** Across operator accounts, the proportion of repeatable workflows that complete without human intervention. The clearest long-term measure of category creation.

## 8. Product principles

These are the strategic positions Crew commits to as a product. They differ from the design and operational principles that govern the runtime — those are owned by the architecture document and cited from here rather than restated.

- **Deploying a crew should be the easy part.** The substrate absorbs operational complexity so a new crew is a question of workflow, personas, and prompts. If a crew author has to think about the substrate, the substrate has failed.
- **Conservative defaults, configurable limits.** Crews ship narrow. Operators expand autonomy explicitly; the platform never assumes permission it was not granted. Trust is earned per crew, not granted to the category.
- **Independent crews, composable pipelines.** Crews must run correctly alone. Composition is added at the orchestration layer, never wired into crew internals. Independence is preserved as the catalogue grows.
- **Compound above the model.** Crew's commercial value lives in what cannot be matched by a single model call: orchestration, memory, evidence, evaluation, and governance. Every investment is judged by whether it compounds across runs.
- **Autonomy and oversight are designed together.** Escalation is a first-class feature, not a fallback. The audit trail is the product, not a debug log. Trust requires showing where automation stops, not only where it goes.
- **Catalogue over feature factory.** Crew grows by adding crews, not by piling features into the runtime. The substrate stays small on purpose; the catalogue carries the surface area.
- **Legible to agents.** Crew is extended by AI agents, including Crew itself. Documentation, contracts, and conventions are written so an agent — not just a human — can reason about them and modify them safely.

## 9. Stakeholders and RACI

| Concern                                       | Responsible  | Accountable | Consulted | Informed |
| --------------------------------------------- | ------------ | ----------- | --------- | -------- |
| Platform substrate (runtime, security, audit) | daddia       | daddia      | —         | —        |
| Vertical crew design (workflow, personas)     | daddia       | daddia      | —         | —        |
| New crew scoping and prioritisation           | daddia       | daddia      | —         | —        |
| Cost, autonomy, and evidence reporting        | daddia       | daddia      | —         | —        |
| External integrations                         | daddia       | daddia      | —         | —        |
| Commercial release, licensing, pricing        | daddia       | daddia      | —         | —        |
| Definition of done per run                    | Story author | Story owner | daddia    | crew     |

Solo-operated today. The RACI expands as crews are operated by or for other teams; downstream operators become Responsible for definition of done and Informed of platform changes.

## 10. Relationship to the parent

Crew is a standalone product with no portfolio parent today. The first vertical proves the substrate; the catalogue is the product; cross-crew orchestration is the long-term wedge.

The compounding bet, across every phase of the strategy: **own the layer above the model, where orchestration, memory, evidence, and governance accumulate value with every run.** A better foundation model raises the floor for a single call; a better runtime raises the floor for every call, forever. Crew is being built to be that runtime.
