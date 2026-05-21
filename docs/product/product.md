---
type: Product Strategy
scope: product
version: '2.0'
owner: daddia
status: Current
last_updated: 2026-05-21
---

# Product -- Crew

## 1. Problem

Autonomous AI agents are everywhere in demos. Reliable, deployable agent teams that run real knowledge work, unsupervised, at known cost — almost nobody has shipped them. The market has hundreds of frameworks, a handful of point agents, and no production substrate.

- **Building one agent team is hard.** Every team starts from scratch on session management, tool allowlists, webhooks, idempotency, state, and recovery. The output is a fragile one-off owned by its author.
- **Operating one in production is harder.** A working notebook is not a service. Reliable startup, crash recovery, duplicate-event handling, cost ceilings, audit trails, and clean escalation are a separate engineering project that most teams never finish.
- **Scaling to two or more is reinvention.** The second agent workflow repeats the same infrastructure work. Without a substrate, every crew is built in isolation, every operational lesson learned twice.
- **Oversight is an afterthought.** Most agent systems have no bounded loops, no escalation path, and no audit trail. Trust requires showing where automation stops, not only where it goes.
- **Coordination across crews is unsolved.** Once two or more crews exist, the next bottleneck is composing them — pipelines that survive failures, fan out, and pause for a human without losing state. Fire-and-forget is adequate for one crew; it is inadequate for a catalogue.
- **Frontier-model improvements do not solve it.** A better model raises the ceiling on a single call. It does not produce orchestration, governance, recall across runs, or cost optimisation across providers. Those are platform problems, and they compound where the model alone cannot.

## 2. Appetite

Four phases. A phase opens when the previous phase exits cleanly; calendar dates are not committed. Sequencing and exit criteria: [`roadmap.md`](roadmap.md).

**Now — prove the pattern with software delivery.** Ship the build slice of the delivery vertical end-to-end on real stories: pickup, clarification, implementation, peer review, MR, CI handoff to QA. This is both useful product and the proof point for the platform — the most demanding crew first, so everything after is easier.

**Next — harden the runtime; close the delivery loop.** Operate unsupervised overnight with predictable recovery and observable cost and quality. Complete the delivery vertical (build → QA → review) and prove the compounding wedge: cost per accepted artefact trends down and recall trends up as the runtime matures.

**Later — open the catalogue.** Add verticals beyond delivery: code review, documentation, discovery (PM, Architect), refine (DM, Technical Writer). Each new crew is workflow plus personas plus prompts — the substrate is reused. The catalogue is the product; delivery is its first proof.

**Future — durable cross-crew orchestration.** Promote coordination from event glue to a first-class platform capability: pipelines that survive process restarts, fan-out from a single trigger, suspend-and-resume around human decisions, and crew-as-a-step composition that lets the platform reason over its own catalogue. This is where the long-term commercial wedge lives.

## 3. Sketch

Crew is **the runtime and catalogue for autonomous knowledge work**. Each crew is an independently deployable service — its own workflow, personas, prompts, and definition of done — built on a shared substrate that handles the parts every crew needs: security at the edge, session management, idempotency, bounded loops, cost ceilings, escalation, and an audit trail per action.

A crew author writes intent: who is on the team, what sequence they execute, what triggers a run, what counts as done. Everything else is provided. A new crew goes from blank slate to deployed service in the same time it currently takes to write the prompts.

The delivery vertical is the first proof and the most demanding workload — multi-persona, multi-phase, external integrations, bounded feedback loops, human gates. Once it runs unattended on real stories, every later crew inherits a runtime that has already paid for crash recovery, observability, and safety.

When a crew reaches the limit of what it can resolve autonomously, it hands back to a human with full context. Autonomy and oversight are designed together, not traded against each other.

In the future phase, individual crews become composable steps in longer pipelines. Coordination moves above the crew: triggering one crew when another finishes, fanning out from a single event, pausing on a human decision, resuming exactly where it stopped. Crews stay independently deployable; the orchestration layer connects them without coupling them. This is what turns a catalogue into a platform.

## 4. Rabbit holes

- **Building a general-purpose agent framework.** Crew is a runtime and deployment layer on top of an agent SDK, not a replacement for one. Model selection, prompt orchestration internals, and tool-call semantics belong to the SDK and the model provider.
- **Owning the operator's workspace.** Crew reads from artefact-centric workspaces it does not own — product docs, designs, conventions, program mirrors. Workspace tooling, scaffolders, and skill libraries are outside this product. The runtime contract is the boundary.
- **Making every step autonomous.** Escalation is a feature, not a failure mode. Crews handle what they can handle well and hand off the rest cleanly. Forcing autonomy past confidence is how trust collapses.
- **One platform, every deployment target.** Multi-region, multi-tenant, and serverless deployment patterns are deferred until the single-container model is proven across more than one crew.
- **Shipping every integration.** Each crew owns the integrations it needs. The platform provides the pattern and the security primitives, not an integration catalogue.
- **Conversational multi-agent graphs.** Personas converge through versioned artefacts, not message passing. There is no shared agent memory and no cross-persona chat state.
- **Browser-based governance UI.** Steering happens by editing strategy artefacts and approving outputs. An admin UI is not on the roadmap.

## 5. No-gos

- Replacing the foundation model or the agent SDK — Crew is a runtime layer, not a model layer.
- Workflows requiring real-time human collaboration mid-run — clean handoff points, not interactive sessions.
- A single run touching multiple repositories, organisations, or security boundaries — one tenant per run.
- Stories or tasks with no definition of done — without an exit condition, a crew cannot close the loop.
- Compliance-driven environments that require a multi-reviewer change-advisory chain inside every PR — Crew is designed for teams that trust autonomous operation within configured bounds.

## 6. Target users

**Primary — small engineering teams running structured backlogs.** They have established coding standards, an existing codebase with patterns, a passing test suite, and a backlog of well-specified stories. They want delivery throughput without growing headcount. They review merged work after the fact rather than in advance. Success: stories merge while they sleep; the audit trail tells them what happened and why.

**Primary — operators of repetitive knowledge work beyond delivery.** Teams that run a consistent multi-step workflow — code review, documentation, release notes, customer-issue triage — and want it to run autonomously on schedule or on event. They care about cost per run and autonomy rate. Success: the workflow runs overnight; they review the output in the morning and move on.

**Secondary — technical leaders evaluating autonomous knowledge work for a larger organisation.** They want to redirect headcount away from rote work toward higher-leverage work. They care about cost per accepted artefact, escalation rate, and audit quality as management metrics. Not daily operators; they set policy and read weekly summaries.

**Out of scope — enterprises with mandatory multi-reviewer approval chains or change advisory boards.** Crew is designed for teams that trust autonomous operation within configured bounds.

**Out of scope — greenfield teams with no patterns or test suite.** Personas need something reliable to read; without a substrate of conventions, the system has no anchor.

## 7. Outcome metrics

Crew is evaluated on three levels. This document names the outcomes; numeric thresholds and benchmark methodology live in Confluence (CrewBench).

**Platform level (applies to every crew).**

- **Autonomy rate.** Share of runs completed without human intervention. The primary signal of platform health.
- **Cost per accepted artefact.** Total spend divided by outputs accepted by humans or downstream gates. The primary commercial metric; the wedge against running a raw model or point agent on the same work.
- **Time to first crew.** For a new domain, how long from blank slate to a deployed, running crew. Measures the leverage of the shared substrate.
- **Audit completeness.** Share of runs reconstructible from the audit trail without consulting the operator. The trust metric.

**Vertical level (delivery first; every later vertical inherits the shape).**

- **Cycle time end to end.** Trigger to accepted output. For delivery: story pickup to merged MR.
- **Escalation rate.** Share of runs that hand off to a human. Stable or trending down at maturity; spiking means the runtime or the input has degraded.
- **Recall across runs.** Share of recurring context retrieved correctly from prior runs without re-prompting. Compounds with project memory and cross-run learning.

**Compounding level (the long-term thesis).**

- **Cost-and-recall trajectory.** Cost per accepted artefact trending down and recall trending up after compaction, memory, and routing land. The proof that the platform improves with use, independently of any single model release.
- **Catalogue breadth.** Number of independently deployable crews running real workloads. The signal that the substrate has earned its name.

## 8. Product principles

- **Deploying a crew should be the easy part.** The substrate absorbs operational complexity so a new crew is a question of workflow, personas, and prompts — not infrastructure.
- **Escalate rather than fail silently.** A visible handoff to a human with context is always preferred to an invisible failure. Trust is built by showing where automation stops.
- **Bounded everything.** Every loop has a cap, every external call a timeout, every run a cost ceiling. Unbounded automation is unbounded spend and unbounded risk.
- **The audit trail is the product.** Every action a crew takes is reconstructible after the fact. Accountability requires visibility, and visibility is non-negotiable.
- **Conservative defaults, configurable limits.** Crews ship narrow. Operators expand autonomy explicitly; the platform never assumes permission it was not granted.
- **Independent crews, composable pipelines.** Crews run correctly alone. Coordination is added at the orchestration layer, never wired into crew internals — so independence is preserved as the catalogue grows.
- **Compound above the model.** The commercial value of Crew lives in what cannot be matched by a single model call: orchestration, memory, evidence, evaluation, and governance. The runtime invests where compounding is possible.
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

Crew is a standalone product. It has no portfolio parent today, and the long-term thesis does not require one.

The delivery vertical is the proof point for the platform. It is the most demanding crew that could be built — multi-persona, multi-phase, external integrations, bounded feedback loops, human gates. Shipping it demonstrates the substrate can support anything else built on top.

Once delivery is hardened, the catalogue opens. Candidates for the second and third verticals are identified where well-defined workflows, clear definitions of done, and high repetition create the most leverage — code review, documentation, discovery cycles, customer-issue triage. Each new vertical reuses the substrate end to end; only intent (workflow, personas, prompts) changes.

The horizon beyond catalogue growth is durable cross-crew orchestration. A coordination layer that treats individual crews as composable steps in longer pipelines: suspend and resume across restarts, fan out and fan in across crews, pause for human decisions without losing state. It does not change how individual crews are built or deployed; it adds a new surface above them — and it is where the platform's long-term commercial wedge lives. The current event model is a deliberate starting point, not an end state. Durable orchestration is a planned upgrade, not a prerequisite for the work in flight.

The compounding bet, across all four phases, is the same: **above the model, where orchestration, memory, evidence, and governance accumulate value with every run.** A better model raises the floor for a single call; a better runtime raises the floor for every call, forever.
