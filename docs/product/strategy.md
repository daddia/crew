---
type: Product Strategy
scope: product
version: '3.1'
owner: daddia
status: Current
last_updated: 2026-06-26
---

# Product Strategy — Crew

## 1. Opportunity

Knowledge work is the largest category of human labour that has never been industrialised. Manufacturing got assembly lines; logistics got containers; software got CI/CD. The long tail of multi-step, judgement-laden, artefact-producing work that runs every modern organisation — engineering, product, operations, research, support — has been waiting for its substrate.

Frontier AI models have made the underlying tasks technically feasible to automate. But the model is the engine, not the car. A model can plan a task, write code, draft a document, review a proposal. It cannot pick the work up from a queue, manage a session across steps, route to the cheapest provider that meets the quality bar, hand off cleanly when it is out of its depth, leave an audit trail a reviewer can trust, or get better at the work with every run. Those are platform problems. No future model release will solve them — and the market knows it.

The market today has hundreds of agent frameworks, a handful of point agents, and almost no production agent teams running real work unsupervised. The gap is not capability. It is operability: the substrate that makes autonomous agent teams safe to deploy, accountable to humans, and cheaper with use.

This is the gap Crew fills.

## 2. Vision

**Anything a team does repeatedly with a defined workflow and a definition of done can be run by a crew.**

A crew is a small team of specialised AI personas that picks up real work, executes it end-to-end, peer-reviews its own output, escalates when it is out of its depth, and leaves an audit trail a human can trust. Each crew is independently deployable — its own service, its own state, its own working hours. Crews do not share memory and do not message each other directly; they converge on versioned artefacts, the same way human teams do.

A growing catalogue of crews — delivery, review, documentation, discovery, triage, operations — runs on a shared substrate that absorbs the operational complexity every crew would otherwise reinvent. The first crew is expensive to build. The tenth is a question of intent.

Above the substrate, a compounding surface makes every run cheaper and more accurate than the last. The platform learns from its own outcomes — not by fine-tuning a model, but by improving the artefacts, policies, and routing decisions that surround it. A better foundation model raises the ceiling on a single call. The compounding surface raises the floor for every call, permanently.

## 3. Strategic position

The agent ecosystem has converged on three layers. Crew's position is deliberate: it occupies the layer between the model and the work, where no incumbent has a structural advantage.

### 3.1 Where Crew does not compete

**Foundation models.** Anthropic, OpenAI, Google, and others own the reasoning layer. Crew is model-agnostic and provider-agnostic by design. A better model makes Crew better — it does not make Crew unnecessary. This is a permanent boundary.

**Agent SDKs and frameworks.** LangChain, CrewAI, AutoGen, Mastra, and the Claude Agent SDK own session management, tool execution, and prompt orchestration internals. Crew is a runtime layer on top of an SDK, not a replacement for one. The SDK is pluggable; Crew's value lives above it.

**Durable agent runtimes.** A newer class of framework packages durable execution, channels, sandboxing, and human-in-the-loop into a filesystem-first runtime for _single_ agents. These validate Crew's core bets (filesystem-first authoring, durability, evals on the production surface) and, more consequentially, commoditise the runtime substrate. Crew treats them as substrate to ride, not rivals to beat: where a maintained durable runtime exists, Crew prefers to adopt its open primitives rather than rebuild them. What these runtimes do not provide is the layer Crew sells — deterministic multi-persona orchestration, a compounding surface, and a workspace contract. A single durable agent is not a crew.

**Single-purpose coding agents.** Cursor, Windsurf, Codex, and Claude Code own the developer-in-the-loop coding experience. Crew is not an IDE extension. It operates unattended on a backlog, not interactively in an editor. The value proposition is throughput and governance, not keystroke assistance.

### 3.2 Where Crew is differentiated

**Runtime, not framework.** Most agent solutions are libraries you build with. Crew is a platform you deploy on. The difference: a framework gives you primitives; a runtime gives you crash recovery, idempotency, bounded loops, cost ceilings, audit trails, and escalation — the things that make the difference between a demo and a service. Every crew in the catalogue inherits these guarantees without reimplementing them.

**Crews, not agents.** The unit of deployment is a team, not a function. A crew has multiple specialised personas, a defined workflow, a peer-review loop, and a definition of done. This is what makes autonomous operation trustworthy — no single agent approves its own work.

**Artefact-based convergence.** Personas do not message each other. They read from and write to versioned artefacts — the same documents, branches, and issues that human teams use. This means every step is auditable, every decision is traceable, and there is no hidden agent-to-agent state that a reviewer cannot inspect.

**Deterministic orchestration, agentic execution.** The workflow is deterministic and reviewable; the model does the work _inside_ bounded steps but never decides the workflow itself — the team, the sequence, or the tool surface. This is the deliberate opposite of an agentic orchestrator that lets a model assemble all of that at runtime: a powerful pattern, but one fundamentally at odds with auditability and bounded operation. Crew keeps the workflow a reviewable artefact and reserves model-generated orchestration as an opt-in, evidence-gated capability, not the default. Predictability is the product.

**Compounding above the model.** Most agent platforms reset on every run. Crew accumulates value across runs: project memory reduces context cost, cross-run evidence trains evaluation policy, model routing optimises cost-quality trade-offs per task type, and specialist optimisers propose improvements to the platform itself based on observed outcomes. The compounding surface is the commercial moat — it is where Crew's value diverges from the model's value with every run.

**Escalation as a feature, not a failure.** When a crew reaches the boundary of what it can handle, it hands back to a human with full context. The handoff is designed, not accidental. Autonomy and oversight are built together — the audit trail is the product, not a debug log. This is what earns trust from operators who would never run an unaccountable agent on real work.

**Workspace contract.** Crew reads from the projects it operates on through a minimum set of steering documents at known locations. This makes autonomy possible without surprise — the agent knows what it is building and why because the team wrote it down. If the contract is not met, the crew escalates rather than guesses. No other agent platform defines or enforces this contract.

**Catalogue economics.** Crew grows by adding crews to the catalogue, not by piling features into the runtime. Each new crew is workflow plus personas plus prompts; everything operational is inherited. The substrate stays small on purpose; the catalogue carries the surface area. This means the marginal cost of the next vertical is a fraction of the first — and the compounding surface benefits every crew equally.

## 4. Sketch

**Crew is the runtime and catalogue for autonomous knowledge work.**

Every crew is built on a shared substrate that provides the guarantees needed to run unattended on real work: security at the edge, session management, idempotency, bounded loops, cost ceilings, clean escalation, and an audit trail per action. A crew author writes intent — who is on the team, what sequence they execute, what triggers a run, what counts as done. Everything operational is provided.

Above the runtime, a compounding surface accumulates value with every run. Project memory reduces re-prompting cost. Cross-run evidence feeds evaluation policy. Model routing picks the cheapest provider that meets the quality bar per task type. Specialist optimisers — independent microservices that read accumulated outcomes from a telemetry warehouse — propose policy changes to the platform itself. The optimisers never sit in the call path of any crew; they operate asynchronously, on their own cadence, improving the substrate that every crew consumes.

Crews read from the projects they operate on through a minimum workspace contract: a product strategy, a solution architecture, and a roadmap at known paths. These steering documents are the source of truth agents work from. If a steering document is missing, the crew escalates rather than guesses.

Individual crews become composable steps in larger pipelines. A coordination layer above the crew triggers one crew when another finishes, fans out from a single event, pauses on a human decision, and resumes exactly where it stopped. Crews stay independently deployable; orchestration connects them without coupling them. This is what turns a catalogue into a platform.

Software delivery is the first proof point — the most demanding workload that could be chosen. Multi-persona, multi-phase, external integrations, bounded feedback loops, human gates. Every later vertical inherits a runtime that has already paid for the hard parts.

## 5. Target users

**Primary — small engineering teams running structured backlogs.** Established coding standards, an existing codebase with patterns, a passing test suite, a backlog of well-specified stories. They want delivery throughput without growing headcount. They review merged work after the fact rather than in advance. Success: stories merge while they sleep; the audit trail tells them what happened and why.

**Primary — operators of repetitive knowledge work.** Teams that run a consistent multi-step workflow — code review, documentation, release notes, customer-issue triage, discovery, refinement — and want it to run autonomously, on schedule or on event. They care about cost per run and autonomy rate. Success: the workflow runs overnight; they review the output in the morning.

**Secondary — technical leaders evaluating autonomous knowledge work for a larger organisation.** They want to redirect headcount from rote work toward higher-leverage work. They care about cost per accepted artefact, escalation rate, and audit quality as management metrics — and about risk exposure, compliance posture, and whether the platform compounds value independently of any single model vendor. They set policy, review summaries, and make the build-vs-buy decision.

**Aspirational — any team with a defined, repeatable workflow and a definition of done.** The long-term target is the broad middle of knowledge work — operations, finance, research, support, internal IT — wherever a multi-step process is run by humans today and could be run by a crew with humans setting policy and reviewing outcomes. The platform earns the right to reach this audience by proving the substrate on the most demanding workload first.

**Out of scope — enterprises with mandatory multi-reviewer approval chains or change advisory boards.** Crew is designed for teams that trust autonomous operation within configured bounds.

**Out of scope — greenfield teams with no patterns or conventions.** Personas need something reliable to read from; without a substrate of established practice, the system has no anchor.

## 6. Product principles

These are the strategic positions Crew commits to. Design and operational principles that govern the runtime are owned by the architecture and cited from here rather than restated.

- **Deploying a crew should be the easy part.** The substrate absorbs operational complexity so a new crew is a question of workflow, personas, and prompts. If a crew author has to think about the substrate, the substrate has failed.
- **Conservative defaults, configurable limits.** Crews ship narrow. Operators expand autonomy explicitly; the platform never assumes permission it was not granted. Trust is earned per crew, not granted to the category.
- **Independent crews, composable pipelines.** Crews must run correctly alone. Composition is added above them, never wired into their internals. Independence is preserved as the catalogue grows.
- **Compound above the model.** Crew's commercial value lives in what cannot be matched by a single model call: orchestration, memory, evidence, evaluation, and governance. Every investment is judged by whether it compounds across runs.
- **Autonomy and oversight are designed together.** Escalation is a first-class feature, not a fallback. The audit trail is the product, not a debug log. Trust requires showing where automation stops, not only where it goes.
- **Catalogue over feature factory.** Crew grows by adding crews, not by piling features into the runtime. The substrate stays small on purpose; the catalogue carries the surface area.
- **Legible to agents.** Crew is extended by AI agents, including Crew itself. Documentation, contracts, and conventions are written so an agent — not just a human — can reason about them and modify them safely.

## 7. Outcome metrics

Crew is evaluated at three levels. This section names the outcomes and their directional targets. Numeric thresholds and benchmark methodology are owned by CrewBench.

**Platform level — applies to every crew.**

- **Autonomy rate.** Share of runs completed without human intervention. The primary signal of platform health. Stable or trending up at maturity; a declining trend signals degrading input quality or runtime regression.
- **Cost per accepted artefact.** Total spend divided by outputs accepted by humans or downstream gates. The primary commercial metric — the wedge against running a raw model or point agent on the same work. Must be lower than the equivalent manual cost, and trending down as the compounding surface matures.
- **Time to a new crew.** For a new domain, how long from blank slate to a deployed, running crew. The leverage signal. Target: hours or days, not weeks.
- **Audit completeness.** Share of runs reconstructible from the audit trail without consulting the operator. Target: complete — the audit trail is the product; partial coverage is a defect, not a trade-off.

**Vertical level — delivery first; every later vertical inherits the shape.**

- **Cycle time end to end.** Trigger to accepted output. Baseline established on the first vertical; improvement expected as memory and routing land.
- **Escalation rate.** Share of runs that hand off to a human. Stable or trending down at maturity.
- **Recall across runs.** Share of recurring context retrieved correctly from prior runs without re-prompting. Near zero at launch; trending up is the compounding proof.

**Long-term — the platform thesis.**

- **Cost-and-recall trajectory.** Cost per accepted artefact trending down and recall trending up after the compounding surface lands. The proof that the platform improves with use, independently of any single model release.
- **Catalogue breadth.** Number of independently deployable crews running real workloads. The signal that the substrate has earned its name.
- **Share of recurring knowledge work that runs unattended.** The proportion of repeatable workflows that complete without human intervention. The clearest long-term measure of category creation.

## 8. Scope boundaries

### Rabbit holes

- Building a general-purpose agent framework — Crew is a runtime layer, not a model layer.
- Owning the operator's workspace — the workspace contract defines the minimum surface; workspace tooling is a different product.
- Making every step autonomous — escalation is a feature, not a failure mode.
- One platform, every deployment shape — simplest shape first, proven across multiple crews before complexity.
- Shipping every integration — each crew owns what it needs; the platform provides the pattern.
- Conversational multi-agent graphs — personas converge through versioned artefacts, not message passing.
- Browser-based governance UI — steering happens in the systems of record.

### No-gos

- Replacing the foundation model or the agent SDK — permanent boundary.
- Real-time human collaboration mid-run — clean handoff points, not interactive sessions.
- A single run touching multiple repositories, organisations, or security boundaries — one tenant per run.
- Work with no definition of done — without an exit condition, a crew cannot close the loop.
- Mandatory multi-reviewer change-advisory chains — Crew respects configured bounds, but does not replace institutional approval processes.

## 9. Stakeholders

| Concern                    | Responsible  | Accountable | Consulted | Informed |
| -------------------------- | ------------ | ----------- | --------- | -------- |
| Platform substrate         | daddia       | daddia      | —         | —        |
| Vertical crew design       | daddia       | daddia      | —         | —        |
| New crew scoping           | daddia       | daddia      | —         | —        |
| Cost, autonomy, evidence   | daddia       | daddia      | —         | —        |
| External integrations      | daddia       | daddia      | —         | —        |
| Commercial release         | daddia       | daddia      | —         | —        |
| Definition of done per run | Story author | Story owner | daddia    | crew     |

Solo-operated today. The RACI expands as crews are operated by or for other teams.

## 10. The bet

Crew is a multi-year platform bet. The compounding thesis, stated once: **own the layer above the model, where orchestration, memory, evidence, and governance accumulate value with every run.** A better foundation model raises the floor for a single call. A better runtime raises the floor for every call, forever. Crew is being built to be that runtime.

The runtime layer itself is commoditising — well-resourced durable-agent frameworks now give away what was once hard to build. That sharpens rather than threatens the bet. It lowers the cost of Crew's substrate and concentrates defensibility where it always belonged: the compounding surface, the multi-persona orchestration, and the catalogue above the runtime. Crew wins by shipping the layer the frameworks do not, on top of the substrate they now provide — and by refusing to spend its scarce effort rebuilding substrate it can borrow.
