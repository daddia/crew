---
type: Product Strategy
scope: product
---

# Product -- Crew

## 1. Problem

Autonomous AI agents are everywhere in demos. Reliable, deployable AI agent teams are rare. The gap between a working prototype and a production service that runs unattended, recovers from failure, respects cost limits, and hands back to a human at the right moment is wide — and almost nobody has crossed it.

- **Building agent teams is hard to standardise.** Every team that attempts this starts from scratch: bespoke session management, ad-hoc tool allowlists, no shared primitives for webhooks, idempotency, or state. The result is fragile one-offs that break in production and cannot be maintained by anyone other than their author.
- **Deploying agent teams is harder.** An agent that works in a notebook is not a service. Turning a multi-step, multi-persona workflow into something that starts reliably, recovers from crashes, handles duplicate events, and reports its costs is a separate engineering project — one most teams never finish.
- **Expanding agent coverage is reinvention.** Once a team builds one agent workflow, the second one repeats the same infrastructure work: new server, new state store, new webhook handlers, new security primitives. There is no reuse across crews unless someone deliberately designed for it.
- **Oversight is an afterthought.** Most agent systems have no bounded loops, no escalation path, and no audit trail. They run until they hit an error or a cost ceiling — whichever comes first. Teams that want accountable automation need these properties built in from the start, not bolted on later.
- **Coordinating work across crews is unsolved.** As the number of crews grows, so does the need to orchestrate work between them: one crew's output becoming another crew's input, long-running pipelines that span hours or days, and fan-out patterns where a single trigger kicks off multiple crews in parallel. Fire-and-forget event handling is sufficient for a single crew; it is inadequate for a network of them.

## 2. Appetite

Three phases.

**Now — prove the pattern with software delivery.** Build and ship the delivery crew end-to-end: story pickup, implementation, peer review, feedback loop, final review, merge. This is both a useful product in its own right and the proof of concept that validates the crew architecture. Success: at least three real stories complete the full delivery sequence without human intervention.

**Next — harden the runtime.** Once the loop is demonstrably reliable, invest in what makes it safe to run unattended at scale: startup reliability, crash recovery, observability, throughput controls. This phase ends when the crew can run overnight unsupervised and produce a cost and quality report in the morning.

**Later — expand to new domains.** With a proven, hardened runtime, the architecture opens to new crews. Each new crew reuses the shared runtime, security primitives, and deployment pattern — only the workflow, personas, and prompts change. The first expansion candidates are identified by where repetitive, sequenced knowledge work is currently done manually.

**Future — durable cross-crew orchestration.** Once multiple crews exist and are running independently, the platform gains a new class of problem: coordinating work across them. This phase introduces durable workflow orchestration as a first-class platform capability — pipelines that survive failures and restarts, fan-out patterns that trigger multiple crews from a single event, and long-running sequences where one crew's output becomes another crew's input. This layer sits above the individual crew and treats each crew as a composable step in a larger pipeline.

## 3. Sketch

Crew is a platform for building and deploying autonomous agent teams. Each crew is a self-contained, independently deployable service — its own server, its own workflow, its own state — built on shared runtime primitives that handle the hard parts: webhook security, session management, idempotency, cost tracking, escalation, and audit.

A crew is defined by three things: the team of agent personas it employs, the workflow sequence those personas execute, and the events that trigger a run. A new crew can be assembled by writing the workflow, the personas, and the prompts. Everything else — serving, security, state, recovery, observability — is provided by the shared runtime.

The delivery crew is the first crew: a three-persona team (engineer, senior engineer, tech lead) that picks up a story, implements it, reviews it, and merges it. It demonstrates every capability the platform provides and ships real value while doing so.

When a crew reaches the limit of what it can resolve autonomously, it hands back to a human with a plain-language summary of what is unresolved and why. Autonomous operation and human oversight are not in tension — the platform is designed to support both.

In a future phase, individual crews become composable steps in larger pipelines. A durable orchestration layer coordinates work across crews: triggering a research crew when a planning crew finishes, running a review crew in parallel with a documentation crew, or suspending a pipeline mid-flight to wait for a human decision before resuming. Each crew remains independently deployable; the orchestration layer connects them without coupling them.

## 4. Rabbit holes

- **Building a general-purpose agent framework.** Crew is not trying to replace agent SDKs or compete with foundation model tooling. It is a deployment and runtime layer — opinionated, production-focused, built on top of an existing SDK, not a replacement for one.
- **Making every step autonomous.** The escalation path is a feature, not a failure mode. Crews are not designed to handle every situation; they are designed to handle the situations they can handle well and hand off everything else cleanly.
- **One platform, all deployment targets.** In the current phase, each crew deploys as a single container on a managed runtime. Multi-region, multi-tenant, and serverless deployment patterns are deferred until the single-container model is proven.
- **Supporting every integration out of the box.** The delivery crew integrates with Jira and GitLab. Future crews will integrate with different systems. The platform provides the integration pattern; it does not ship every integration.

## 5. No-gos

- Replacing the underlying agent SDK or foundation model — Crew is a runtime layer, not a model layer.
- Workflows requiring real-time human collaboration mid-run — the platform is designed for autonomous runs with clean handoff points, not interactive sessions.
- Crews that span multiple repositories, organisations, or security boundaries in a single run.
- Stories or tasks with undefined success criteria — every crew needs a definition of done to validate against before it can close the loop.

## 6. Target users

**Primary — developer or small technical team who wants to automate a repeatable knowledge work workflow.** They have a well-understood process that follows a consistent sequence, they are comfortable with autonomous tooling, and they want the workflow to run without babysitting. They care about cost per run and autonomy rate. Success: the workflow runs overnight; they review the output in the morning and move on.

**Primary — solo developer or small engineering team using the delivery crew.** They have a steady backlog of well-specified stories and want to ship faster without growing the team. They review merged work after the fact rather than in advance. Success: stories merge while they sleep; the audit trail tells them exactly what was done and why.

**Secondary — technical leader evaluating autonomous delivery for a larger team.** They want to redirect engineers away from rote delivery and toward higher-leverage work. They care about cost-per-story, escalation rate, and audit quality as management metrics. They are not daily operators; they set policy and read weekly summaries.

**Out of scope — enterprise teams with mandatory multi-reviewer approval workflows, compliance gates, or change advisory boards.** The crew is designed for teams that trust autonomous operation within configured bounds, not for organisations where every change requires a human sign-off chain.

## 7. Outcome metrics

Crew is evaluated on two levels:

**Platform level (applies to every crew):**

- **Autonomy rate** — the percentage of runs that complete without a human intervention. This is the primary signal of platform health. A declining autonomy rate means crews are receiving work they cannot handle, or that the runtime is failing them.
- **Cost per run** — total spend per completed workflow execution. This is the primary commercial metric. The expectation is that cost decreases as prompts and skills mature. A rising trend is a signal to investigate.
- **Time to first crew** — for a new domain, how long it takes to go from blank slate to a deployed, running crew. This measures the leverage of the shared runtime.

**Delivery crew level:**

- **Cycle time** — story from entering the delivery sequence to merged MR. Target: meet or beat the team's current median on comparable stories.
- **Escalation rate** — percentage of stories that require human intervention. Target range defined in `docs/solution.md`.

Numeric thresholds, alert conditions, and baseline measurements live in `docs/solution.md`.

## 8. Product principles

- **Deploying a crew should be the easy part.** The platform absorbs the operational complexity — security, state, recovery, observability — so that building a new crew is a question of workflow and prompts, not infrastructure.
- **Escalate rather than fail silently.** When a crew cannot proceed with confidence, it hands back to a human with context intact. Invisible failures are worse than visible escalations. Trust in autonomous systems is built by showing where they stop, not only where they go.
- **Bounded everything.** Every loop has a cap. Every call has a timeout. Every run has a cost limit. Unbounded automation is unbounded spend and unbounded risk. This is a commercial constraint and a safety constraint.
- **The audit trail is the product.** Every action every crew takes is logged. A team member should be able to reconstruct what happened in any run — what each agent decided, what it cost, why it escalated — without asking anyone. Accountability requires visibility.
- **Conservative defaults, configurable limits.** Crews ship with narrow defaults. Teams that want more autonomy expand the limits explicitly. The platform never assumes permission it was not given.
- **Independent crews, composable pipelines.** Each crew is independently deployable and independently operable. Coordination between crews is additive — a crew that works alone should keep working alone when a pipeline is added around it. Coupling is introduced at the orchestration layer, never at the crew layer.

## 9. Stakeholders and RACI

| Concern                                      | Responsible  | Accountable  | Consulted | Informed |
| -------------------------------------------- | ------------ | ------------ | --------- | -------- |
| Platform architecture and runtime            | daddia       | daddia       | —         | —        |
| Delivery crew design and prompts             | daddia       | daddia       | —         | —        |
| New crew scoping and prioritisation          | daddia       | daddia       | —         | —        |
| Cost monitoring                              | daddia       | daddia       | —         | —        |
| Integration with external systems            | daddia       | daddia       | —         | —        |
| Definition of done per story (delivery crew) | Story author | Story author | daddia    | crew     |

This is a solo-operated product in its current phase. The RACI expands when crews are operated by or for other teams.

## 10. Relationship to parent

Crew is a standalone product with no parent in the current portfolio.

The delivery crew is the proof point for the platform. It is the most complex crew that could be built — multi-persona, multi-phase, external integrations, bounded feedback loops — so shipping it demonstrates that the platform can support any crew built on it.

Once the delivery crew is hardened and running reliably, the platform opens to expansion. The second and third crews will be identified by where the combination of a well-defined workflow, a clear definition of done, and high repetition creates the most leverage. The delivery crew's architecture — shared runtime, independent deployment, reusable primitives — is designed from the start to make that expansion fast.

The horizon beyond multi-crew expansion is durable cross-crew orchestration: a coordination layer that treats individual crews as composable steps in longer-running pipelines. This layer introduces the ability to suspend and resume work across process restarts, coordinate fan-out and fan-in patterns across crews, and wait for human decisions mid-pipeline without losing state. It does not change how individual crews are built or deployed; it adds a new surface above them. The delivery crew's current fire-and-forget event model is a deliberate starting point — durable orchestration is a future upgrade to the platform, not a prerequisite for the current phase.
