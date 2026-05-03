# Proposal Discussion Paper

## AI Agent Code Review for GitLab CI/CD

---

## 1. Executive Summary

This paper proposes the introduction of AI-assisted code review for the Storefront codebase, complementing the existing Datadog static analysis and human review process. The capability is portable across GitLab.com (Storefront) and self-hosted GitLab (other organisational projects), positioning a single approach to scale across the engineering organisation.

The recommended approach:

- **Tool:** Claude Code via Anthropic's official GitLab CI/CD integration.
- **Pipeline pattern:** Child pipeline triggered from the main MR pipeline, isolating AI review from delivery-critical jobs.
- **Agent execution:** Single agent for the proof of concept; orchestrator with parallel sub-agents from Phase 2, providing in-process aggregation, dedup and cost control as specialisation grows.
- **Trigger:** When an MR transitions from Draft to Ready ("submitted for final review"), with optional on-demand invocation during development via `@claude` mention.
- **Output:** Inline review threads tied to specific files and lines, with severity tags — matching the UX pattern engineers already understand from Datadog.
- **Posture:** Advisory; complements rather than gates. Hard gating remains the responsibility of deterministic tools.
- **Governance:** Version-controlled prompts and standards, defined ownership, measurable success criteria, and explicit stop conditions on cost and delivery harm.

### Decision Requested

Approval to proceed with a 4–6 week proof of concept on the Storefront codebase, with:

- An investment envelope of **predominantly engineering time** (~1.5 weeks of senior engineering for setup) plus an estimated **AUD 300–500 in tooling costs** over the POC period.
- Defined go/no-go criteria for Phase 2 expansion.
- Capability ownership assigned to a named senior engineer with architect-level sponsorship and CIO visibility at quarterly review.

---

## 2. Strategic Rationale

Three factors make this the right time to introduce AI-assisted code review:

1. **Frontier model capability has crossed a usable threshold.** Field reports from teams running similar setups in production describe AI review feedback as comparable in quality to a junior-to-mid-level human reviewer on framework-specific concerns. The gap between AI review and useful AI review has closed.

2. **Storefront is at a scale where review consistency matters.** As the codebase and team grow, the variance in human review quality becomes a delivery risk. AI review provides a consistent floor across all MRs.

3. **The pattern is portable and reusable.** The same architecture scales to other GitLab projects across the organisation, providing capability lift without per-team reinvention.

The proposal positions the organisation to:

- Reduce reviewer burden on lower-level concerns and refocus human reviewers on architecture, design intent and engineering judgement.
- Build internal capability in AI-augmented engineering practices — a multi-year strategic competency.
- Establish a portable pattern that scales across teams without divergent tooling or per-team integrations.
- Maintain control of the implementation: open ecosystem, version-controlled prompts, provider flexibility, no vendor lock-in.

The advisory-first, measurement-led approach manages risk while building organisational learning. The capability is treated as production engineering tooling, not as an experiment running in production.

---

## 3. Context

The Storefront platform is built on:

- Next.js 16+
- React 19+
- TypeScript
- GitLab.com (Storefront repository); self-hosted GitLab in use elsewhere in the organisation
- Datadog static code analysis on MR open
- Modern CI/CD pipeline with build, test, lint, quality gates and deployment

The current automated review surface is strong on deterministic checks. Datadog provides fast static analysis feedback on MR open. ESLint, Prettier, the TypeScript compiler and the test suite cover formatting, types and correctness.

What is missing is a layer of judgement-based review — review that reasons about design intent, framework idioms, architectural fit, maintainability and edge cases that no static analyser can identify. That is the gap this proposal addresses.

---

## 4. Constraints and Portability Requirements

Three constraints frame the design:

### 4.1 Source code residency

Storefront source code currently sits on GitLab.com. Decisions about which model providers and regions can receive code must be confirmed before rollout. The default working assumption is Anthropic API direct, or via AWS Bedrock in `ap-southeast-2` if data residency requires it. Self-hosted models are out of scope at this stage.

### 4.2 Portability across GitLab.com and self-hosted

Whatever tool we adopt must run cleanly on both GitLab.com and self-hosted GitLab. This rules out tools that only integrate with one or the other. Claude Code's CI/CD integration is a CI job that runs an installed CLI against an LLM provider — the same pattern works on both topologies.

### 4.3 No duplication of existing automated checks

The AI reviewer must not re-surface findings already covered by Datadog, ESLint, TypeScript or the test suite. Comment fatigue erodes trust faster than any other failure mode.

---

## 5. Problem Statement

The current code review process relies heavily on human reviewers to identify issues across a broad range of dimensions: code quality, maintainability, framework patterns, security risks, performance impacts, accessibility, test coverage and internal standards.

Challenges:

- Reviewers spend time on issues that could be surfaced earlier.
- Review quality varies by reviewer experience and context loaded.
- Specialist knowledge (e.g. Next.js App Router patterns, React 19 idioms) is unevenly applied.
- Review bottlenecks grow as Storefront delivery scales.
- Existing automated checks are strong for deterministic validation but cannot reason about intent.

The opportunity is to introduce an AI-assisted first pass that complements existing static checks and human review.

---

## 6. Objectives

The AI code review capability should:

1. Improve first-pass review quality by surfacing meaningful issues before human review.
2. Apply Storefront-specific standards (Next.js, React 19, TypeScript, design system, BFF patterns) consistently.
3. Reduce reviewer load on lower-level issues so humans focus on architecture and product correctness.
4. Provide review against well-defined lenses, starting with one and expanding as the capability matures.
5. Run on both GitLab.com and self-hosted GitLab without divergent tooling.
6. Avoid destabilising the main pipeline.
7. Be measurable, so improvement is data-driven rather than impressionistic.

---

## 7. Relationship to Existing Tooling

The AI reviewer slots in alongside existing checks. It does not replace any of them.

| Stage | Tool | When | Speed | Nature |
|---|---|---|---|---|
| MR opened | Datadog static analysis | Every push | Fast (seconds) | Deterministic, rules-based |
| MR opened | ESLint, Prettier, tsc | Every push | Fast (seconds) | Deterministic |
| MR opened | Test suite | Every push | Medium | Deterministic |
| MR opened | Build | Every push | Medium | Deterministic |
| MR ready for review | **AI agent review** | Draft → Ready | Slower (1–3 min) | Judgement-based |
| MR ready for review | Human reviewer | On request | Variable | Judgement + accountability |
| Optional during draft | AI agent on `@claude` | On mention | Slower | Judgement, on-demand |

Datadog handles fast deterministic feedback. The AI agent handles slower judgement-based feedback closer to human review. They do not overlap.

---

## 8. Architecture

The capability operates at two architectural layers. Distinguishing them clarifies what is fixed across phases and what evolves.

### 8.1 Pipeline isolation: child pipeline (all phases)

The AI review runs in a child pipeline triggered from the main MR pipeline, after deterministic checks pass. This isolation envelope is consistent across all phases.

```
Main MR Pipeline
│
├── install
├── lint
├── typecheck
├── test
├── build
│
└── trigger: ai-review-child-pipeline (advisory, allow_failure)
```

The child pipeline pattern provides:

- Separation from delivery-critical jobs.
- Independent failure mode (advisory, non-blocking).
- Cost and runtime isolation.
- Independent iteration without touching the main pipeline.

### 8.2 Agent execution: single agent → orchestrator with sub-agents

What runs inside the child pipeline evolves with maturity.

#### Phase 1 — single agent

A single Claude Code agent runs against a combined prompt covering code quality and framework patterns. It produces structured findings and posts inline threads.

```
CI job → Single agent → Findings → Poster → GitLab threads
```

This shape is deliberate for the POC: it minimises moving parts, makes prompt iteration straightforward, and produces a clean baseline for measuring value.

#### Phase 2 onwards — orchestrator with sub-agents

The CI job invokes an orchestrator agent that dispatches focused sub-agents in parallel, then aggregates and posts results.

```
CI job → Orchestrator agent
            │
            ├── Dispatches sub-agents based on changed files
            │
            ├── Sub-agent: code quality       ─┐
            ├── Sub-agent: framework patterns ─┤  Parallel,
            ├── Sub-agent: test quality       ─┤  tight prompts,
            ├── Sub-agent: performance        ─┘  structured findings
            │
            ├── Aggregator: dedupe overlapping findings
            ├── Prioritiser: enforce severity gates and caps
            │
            └── Poster: opens GitLab threads
```

This pattern is preferred over multiple parallel CI jobs because:

- Aggregation and dedup happen in-process before any comment is posted.
- Shared context (MR diff, linked issue, repo structure) is loaded once and passed to sub-agents in scoped slices.
- The orchestrator can adaptively skip irrelevant sub-agents (e.g. no performance review on docs-only changes).
- A single cost control and timeout point governs the entire run.
- A single comment-cap and rate-limit enforcement point applies across all lenses.
- New review lenses are added as sub-agents under the orchestrator, not as new CI jobs.

Cost: roughly 2–3× a single-agent run for moderate MRs, but sub-agents work with tight scoped context so individual calls are cheaper. Dedup reduces posted comments rather than adding to them. Cost-per-useful-comment is generally better than single-agent.

Latency: sub-agents run in parallel; wall-clock is the slowest sub-agent plus aggregation, not the sum.

This architecture is native to Claude Code (sub-agent capability) and aligns with the published orchestrator-worker pattern for multi-agent systems. It also avoids the procurement and integration overhead of mixing specialised vendor tools — specialisation comes from prompts, tool grants and scoped context, not from product mixing.

---

## 9. Trigger Model

Three triggers, each serving a distinct purpose:

### 9.1 Primary: MR Draft → Ready transition

When an engineer marks the MR as ready for review, the AI review fires. This is the equivalent of "submitted for final review" — the engineer has signalled they are done iterating and want feedback. This is the default and covers the majority of cases.

### 9.2 Optional: `@claude` mention during draft

While the MR is in draft, an engineer can invoke the agent on demand by commenting `@claude review`. This supports as-you-go feedback during development without paying the cost of running on every push.

### 9.3 Excluded triggers

The AI review does NOT run automatically on:

- Every push.
- Docs-only changes.
- Lockfile-only changes.
- Changes outside source paths (e.g. CI config alone).

Datadog continues to handle MR-open feedback. The AI agent enters at the "ready for review" stage, when human reviewers also engage.

---

## 10. Tool Selection — Claude Code

The recommended tool is **Claude Code via Anthropic's official GitLab CI/CD integration** (currently in beta, maintained by GitLab).

Reasons:

- **Portability.** Runs on GitLab.com and self-hosted GitLab via the same CI/CD job pattern. This is the deciding factor for organisation-wide rollout.
- **Provider flexibility.** Supports Anthropic API direct, AWS Bedrock and Google Vertex AI — relevant for data residency, procurement and existing cloud agreements.
- **Native sub-agent support.** Claude Code's sub-agent capability directly supports the orchestrator pattern in Section 8.2.
- **Repo-aware reasoning.** The agent can read related code, search the codebase and reason beyond the diff alone. Field reports are clear: prompt-with-a-diff produces generic feedback; agent-with-tools produces targeted feedback.
- **CLAUDE.md as primary control surface.** A `CLAUDE.md` file at the repo root encodes standards, review criteria and conventions that the agent reads on every run. Standards become version-controlled and reviewable.
- **GitLab-native posting.** Posts comments and opens discussion threads via the GitLab API, with the same affordances as a human reviewer.
- **Open ecosystem.** The Agent SDK is published, the integration is openly documented, and we can extend, tune or replace components as needs evolve.

Alternatives assessed:

- **Vercel Agent.** Likely strong on Next.js but tied to Vercel-hosted workflows. Out of scope as a primary option for self-hosted GitLab. Monitor as reference architecture.
- **Specialised vendor mix (e.g. Vercel for frontend lenses, others for security).** Rejected. Different output formats and cost models complicate aggregation; multi-vendor procurement and residency conversations multiply; specialisation from prompts and sub-agents within a single vendor framework gives equivalent capability with materially lower integration cost.
- **Open-source tools (PR-Agent, AI Review, LiveReview, Hexmos).** Viable, with varying levels of GitLab support, but none provide equivalent control over prompt, tool grants and model selection. Worth reassessing if Claude Code does not meet our needs after the POC.
- **Custom LLM-API wrapper.** Maximum control, maximum maintenance burden. Only justifiable if Claude Code proves insufficient.

---

## 11. Output and Comment Model

The output model matches the UX pattern engineers already understand from Datadog: **per-issue threads with file and line references**.

### 11.1 Per-finding thread

For each finding, the agent opens a GitLab discussion thread:

- Anchored to a specific file and line (or line range).
- Tagged with severity (Critical / High / Medium / Low / Note).
- Stating the issue concisely.
- Including rationale and a suggested fix.
- Optionally including a one-click code suggestion the author can apply directly.
- Clearly labelled as AI-generated (via a dedicated bot user identity and comment prefix).

### 11.2 Summary comment

One summary comment per run covering:

- Overall assessment in two or three sentences.
- Count of findings by severity.
- Files reviewed.
- Run metadata (model, duration, cost) for observability.

### 11.3 Comment volume guardrails

To prevent comment fatigue:

- Hard cap: **maximum 10 inline threads per MR** in the POC phase.
- Severity threshold: **Critical and High only** in Phase 1; expand to Medium once trust is established.
- Confidence threshold: agent must rate findings as ≥ medium confidence before posting. Lower-confidence observations go in the summary, not as threads.
- One thread per issue. The agent does not re-comment on the same issue across iterations.

### 11.4 Thread resolution and re-runs

- Engineers resolve threads as they would human review threads.
- On subsequent runs (e.g. after a push), the agent does not re-open already-resolved threads.
- If the project has GitLab's "all threads resolved before merge" setting enabled, AI threads behave identically to human threads — they require explicit resolution. This delivers the "blocking-like" UX of Datadog without making the AI a hard gate. A "won't fix" with reasoning is a valid resolution.

---

## 12. Review Scope

### 12.1 POC scope (Phase 1) — single agent, combined lens

A single agent covering **code quality and framework patterns**:

- Readability, maintainability, simplicity.
- TypeScript correctness beyond what tsc catches (complex generics, narrowing, discriminated unions).
- Error handling and edge cases.
- Next.js App Router conventions.
- Server vs client component boundaries.
- Data fetching, caching and revalidation patterns.
- React 19 idioms.

Deliberately out of scope for Phase 1:

- Security (handled by existing scanners; high false-positive risk for AI early on).
- Performance (requires bundle and runtime context the agent doesn't have access to in Phase 1).
- Accessibility, design system compliance, test quality (added in later phases).

This avoids the trap of multi-agent rollout without a tuned baseline. Prove a single agent works well, then specialise.

### 12.2 Future review lenses (Phase 2+) — sub-agents under the orchestrator

Once the single-agent POC delivers reliable signal, the architecture transitions to orchestrator + sub-agents (Section 8.2). Specialisation comes from adding sub-agents with focused prompts and tool grants, not from adding parallel CI jobs.

Candidate sub-agents include:

- **Performance.** Bundle size, hydration, Core Web Vitals risks.
- **Security.** Alongside existing scanners, focused on judgement issues like authz logic and unsafe patterns.
- **Test quality.** Edge cases, assertion strength, brittleness.
- **Design system.** Webster component usage, token compliance, accessibility patterns.
- **BFF / API integration.** Domain placement, contract patterns.

The orchestrator dispatches sub-agents conditionally based on changed files (e.g. design system sub-agent only fires when component code changes). The decision on which sub-agents to enable, and in what order, is made on POC and Phase 2 evidence.

---

## 13. Leading Best Practices

The implementation follows established practices from teams running AI MR review in production:

1. **Read-only by default.** The reviewer agent has read access to the repo, codebase search, and the GitLab API for posting comments. It does NOT have file-write or shell-edit tools enabled. This eliminates an entire category of risk.

2. **Sandboxed execution with network allowlist.** The runner is restricted to package registries, the LLM provider endpoint, and the GitLab instance. No general internet egress.

3. **Structured output.** The agent (or orchestrator) produces structured JSON which a thin posting layer converts into GitLab threads. This makes output predictable, testable and rate-limitable.

4. **Linked issue / ticket context.** The agent reads the linked issue or ticket to understand intent. Reviews then catch "this change contradicts what the ticket asked for" — a class of issue static tools fundamentally cannot find.

5. **Codebase search tools.** The agent has search and read tools so it can find related code and patterns, not just the diff.

6. **Project-specific standards in `CLAUDE.md`.** Storefront conventions, BFF patterns, design system rules, performance budgets and testing standards are encoded in `CLAUDE.md`. This file is treated as a first-class engineering asset, reviewed and updated as standards evolve.

7. **Cost-bounded runs.** Explicit token, file count and runtime budgets per run. Oversized MRs (e.g. over 50 files) are refused with a clear message rather than running an expensive degraded review.

8. **Don't duplicate deterministic tooling.** Explicit prompt directive: do not comment on issues already covered by ESLint, TypeScript, Prettier, Datadog, or existing security scanners.

9. **Confidence and severity gating.** Only findings above defined thresholds are posted; everything else is observational and goes in the summary or is dropped.

10. **Feedback loop instrumentation.** Engineer reactions on every comment (👍 / 👎 conventions, thread resolution status with reason) are collected. This data drives prompt iteration.

11. **Version-control prompts and configuration.** Prompts live in the repo alongside the code being reviewed, change via MR, and are reviewable by anyone.

12. **Single-thread iteration.** Each finding is one thread. The agent does not generate multiple comments for the same issue across re-runs.

---

## 14. Guardrails

### 14.1 Advisory first

The AI reviewer does not satisfy any required-reviewer count, cannot resolve threads on the engineer's behalf, and cannot approve MRs. Threads it opens behave like human reviewer threads.

### 14.2 Human ownership remains

Human reviewers remain accountable for final approval. The AI is a reviewer assistant.

### 14.3 Avoid duplicate feedback

The agent must not comment on issues already covered by ESLint, TypeScript, Prettier, Datadog, security scanners or test failures. This is encoded in the prompt and reinforced in `CLAUDE.md`.

### 14.4 Source code, secrets and provider trust

- API keys are stored as masked, protected GitLab CI/CD variables.
- Code transmission to the model provider follows the data residency decision (Section 4).
- Prompts and outputs are logged for observability and cost tracking, but not used for model training (per provider terms).
- Files matching a denylist (e.g. `.env*`, certificate files, anything in `secrets/`) are excluded from the review context.

### 14.5 Tool grants are explicit and minimal

Phase 1 grants:

- Read repository files.
- Search the codebase.
- Read the linked issue / MR description.
- Post comments and open discussion threads via the GitLab API.

NOT granted in Phase 1:

- File write or edit.
- Shell execution.
- General internet access.
- Approve or merge actions.

### 14.6 Version-controlled prompts and configuration

Prompts and configuration live in the repository:

```
.gitlab/
  ci/
    ai-code-review.yml
scripts/
  ai-review/
    review.sh
docs/
  ai-review/
    prompts/
      code-quality-and-framework.md
CLAUDE.md
```

---

## 15. Measurement and Metrics

The capability is only valuable if measurable. From day one, instrument:

### 15.1 Quality metrics

- **Comment acceptance rate.** Percentage of AI comments resulting in a code change before merge. Target: >40% in Phase 1.
- **Comment thumbs reaction.** 👍 vs 👎 ratio on AI comments. Target: >3:1.
- **False-positive rate.** Comments resolved as "not an issue" / total comments. Target: <25%.
- **Severity distribution.** Are findings appropriately distributed across severities, or all flagged High?

### 15.2 Adoption metrics

- **MR coverage.** Percentage of merged MRs that received an AI review.
- **Engineer engagement.** Percentage of AI threads receiving a response (resolved or replied) vs ignored.
- **Repeat invocation rate.** Percentage of MRs where engineers invoked `@claude` in draft phase (signals perceived value).

### 15.3 Cost and performance metrics

- **Cost per MR.** AUD per MR. Field benchmark: ~AUD 0.75 per review. Target: <AUD 2.00 per MR average.
- **Wall-clock time.** Time from trigger to first comment posted. Target: <3 minutes.
- **Context size and tool call counts.** For tuning.

### 15.4 Delivery metrics (to detect harm)

- **Time-to-merge.** Median time from MR ready to merge. AI review must not slow this materially. Target: no regression vs baseline.
- **Deployment frequency.** Watched at the team level. AI review must not reduce throughput.

A simple dashboard (Datadog or Grafana), updated weekly, makes these visible to the team and reported into engineering leadership monthly.

---

## 16. Continuous Improvement and Stop Conditions

The capability is treated as a continuously improving system, not a build-and-forget deployment. Prompts, scope and behaviour will not be right on the first attempt.

### 16.1 Continuous improvement loop

- **Weekly:** Review measurement dashboard. Triage thumbs-down comments. Identify prompt or scope changes.
- **Bi-weekly:** Apply prompt and config changes via MR. Track impact in the next dashboard cycle.
- **Monthly:** Review tool grants, cost trajectory, and whether to expand scope (additional sub-agents, broader severity thresholds).
- **Quarterly:** Decide on scope expansion, model upgrade, or specialisation. Report status to engineering leadership and CIO.

### 16.2 Stop conditions

The capability is paused or significantly scaled back if either of the following holds for two or more consecutive measurement cycles:

1. **Cost.** Average cost per MR exceeds AUD 5, or total monthly spend exceeds budget without offsetting value.
2. **Delivery harm.** Median time-to-merge increases materially due to AI review (e.g. >20% regression sustained), or deployment frequency falls.

Other failure modes (high noise, low acceptance, false positives) are addressed through iteration, not termination. The default posture is "improve, don't kill."

---

## 17. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Comment noise erodes trust | Medium | High | Severity gating, comment caps, weekly noise review |
| AI hallucinates non-existent APIs in suggestions | Medium | Medium | Prompt reinforcement, codebase search tools, engineer review of all suggestions before applying |
| Cost spikes on large MRs | Medium | Medium | Diff size cap, file count cap, refusal of oversized MRs |
| Provider outage blocks reviews | Low | Low | Advisory posture (`allow_failure: true`); MRs proceed without AI review on outage |
| Model regression on provider upgrade | Medium | Medium | Pin model version explicitly; test prompt changes before promoting |
| False-positive security findings waste eng time | Medium | High | Security sub-agent deferred; out of scope in Phase 1 |
| Code or secrets leak via prompts | Low | High | Provider terms review; secrets file denylist; data residency decision in Section 4 |
| Engineers mute or ignore AI comments | Medium | High | Measure engagement explicitly; iterate on prompts based on thumbs-down data |
| Duplication of Datadog feedback | Medium | High | Explicit prompt directives; review of AI vs Datadog comment overlap monthly |
| Vendor concentration risk | Low | Medium | Provider abstraction (Anthropic API / Bedrock / Vertex); open-source SDK; portable architecture |

---

## 18. Investment Envelope

All figures are estimates based on industry benchmarks; the POC will refine them. Volumes scale with team adoption and MR throughput.

### 18.1 POC (Phase 1, 4–6 weeks)

- Engineering setup: ~1.5 weeks of senior engineering time.
- Tooling cost: ~AUD 300–500 total over the POC, based on the volunteer cohort × estimated MR volume × ~AUD 1 per review.
- Predominant investment is engineering time, not tooling.

### 18.2 Steady state (Phase 2, full Storefront)

- Tooling cost: ~AUD 1,000–2,000 per month at single-agent scope, depending on MR volume.
- Engineering ownership: ~10% of one senior engineer on prompt and config iteration, plus measurement review.

### 18.3 With orchestrator + sub-agents (Phase 3)

- Tooling cost: ~AUD 2,500–4,000 per month at full sub-agent scope.
- Engineering ownership: increases proportionally with sub-agent count, but each addition is incremental.

### 18.4 Org-wide rollout (post-Storefront)

- Scales linearly with team count and MR volume.
- Cost per team predictable from the Storefront benchmark.
- Tooling investment remains modest relative to engineering productivity gains, particularly when measured against reviewer time saved.

### 18.5 Out of scope at this stage

- Self-hosted models or model infrastructure.
- Custom LLM tooling.
- Multi-vendor AI product mix.
- Hard pipeline gating that AI is not yet trusted to control.

This treats investment as scaling with proven value rather than committing upfront capacity.

---

## 19. Governance and Accountability

The capability operates within existing engineering and security governance, with the following specific accountabilities:

- **Capability owner:** a named senior engineer accountable for prompt quality, cost trajectory and dashboard review.
- **Architecture sponsorship:** at the architect / principal level, with CIO visibility on quarterly review.
- **Security review:** data residency, secrets handling and provider terms reviewed and signed off before each phase transition.
- **Cost ownership:** capability owner reports monthly spend; engineering leadership owns the budget envelope.
- **Change governance:** prompt and configuration changes go through MR review by at least two senior engineers.
- **Stop-condition authority:** capability owner has authority to pause the capability if stop conditions are met; resumption requires architecture sponsor sign-off.
- **Reporting cadence:** weekly dashboard at team level; monthly summary to engineering leadership; quarterly review with CIO visibility on status, cost trajectory, and proposed phase transitions.

The capability is treated as production engineering tooling with the same governance disciplines as other production systems.

---

## 20. Phased Rollout

### Phase 1 — POC (4–6 weeks)

- Single agent, single combined lens (code quality and framework patterns).
- Trigger on MR Draft → Ready, plus `@claude` on demand in draft.
- Run on Storefront (GitLab.com) only.
- Critical and High severity threads only, capped at 10 per MR.
- Advisory; `allow_failure: true`.
- Measurement dashboard live from day one.
- Volunteer cohort: 3–5 teams or engineers.

Success criteria:

- Comment acceptance rate >40%.
- Thumbs reaction ratio >3:1.
- Cost per MR <AUD 2 average.
- No measurable time-to-merge regression.
- Qualitative: human reviewers report the AI review adds value.

### Phase 2 — Broader rollout and orchestrator transition (8–10 weeks)

- Expand to all Storefront engineers.
- Loosen severity threshold to include Medium once acceptance rate is stable.
- Begin extending `CLAUDE.md` to encode more Storefront-specific standards.
- **Architecture transition: introduce orchestrator pattern** with the existing single agent as the first sub-agent. This validates the orchestrator architecture before adding specialisation.
- Validate the same pattern works on a self-hosted GitLab project as a portability check.

### Phase 3 — Specialisation via sub-agents

- Add sub-agents for specialised lenses (Performance and Test Quality first; others as evidence supports).
- Conditional dispatch based on changed files.
- Per-sub-agent measurement and tuning.
- Continued advisory posture.

### Phase 4 — Operational maturity

- Prompt and sub-agent change workflow with peer review and rollback.
- Cost dashboards integrated into engineering metrics.
- Defined model upgrade process per sub-agent.
- Documented runbook for AI review failures, prompt regressions and cost incidents.

There is deliberately no "blocking gate" phase. The AI reviewer remains advisory. Hard gating is the responsibility of deterministic tools.

---

## 21. Key Design Decisions

1. **AI review is first-pass and complementary.** It does not replace Datadog static analysis or human reviewers.
2. **Child pipeline pattern (all phases).** Isolation, runtime control, extensibility.
3. **Trigger on Draft → Ready, with optional `@claude` in draft.** Aligns AI engagement with the moment human review begins.
4. **Inline threads with file/line references.** Matches the Datadog UX engineers already understand. Threads can be configured to require resolution before merge, providing soft gating without making the AI a hard gate.
5. **Single agent for POC.** Prove the pattern before specialising.
6. **Orchestrator + sub-agents from Phase 2.** Specialisation through sub-agents under a single orchestrator, not parallel CI jobs. Aggregation, dedup and cost control are in-process.
7. **Single-vendor framework, multi-prompt specialisation.** Specialisation comes from prompts, tool grants and scoped context within Claude Code, not from mixing specialised vendor tools.
8. **Claude Code as the tool.** Portable across GitLab.com and self-hosted; provider-flexible; native sub-agent support; `CLAUDE.md` as control surface.
9. **Read-only tool grants.** No file writes, no shell, no internet egress in Phase 1.
10. **Version-controlled prompts and `CLAUDE.md`.** Standards live in code.
11. **Measurement from day one.** Continuous improvement is data-driven.
12. **Advisory by default, indefinitely.** No "Phase 4 hard gate" plan. Hard gating is the job of deterministic tools.

---

## 22. Open Questions

To be resolved during POC kickoff:

1. **Provider and region.** Anthropic API direct, or Bedrock in `ap-southeast-2`? Decision driven by data residency confirmation.
2. **Bot identity.** Use the GitLab CI/CD bot, a dedicated service account, or a project access token? Affects how comments appear in the UI and how engineers can react and resolve.
3. **Linked issue source.** Storefront's issue tracker (Jira, GitLab issues, Linear) drives the agent's "linked issue context" tool configuration.
4. **Initial prompt authorship.** Suggested: a small group of senior engineers including framework specialists, with the capability owner accountable for the v1 prompt and `CLAUDE.md` additions.
5. **Volunteer cohort.** Selection criteria: high MR throughput, diverse code areas, willingness to give feedback.
6. **Dashboard ownership.** Suggested: capability owner, with monthly reporting into engineering leadership.

---

## 23. Recommendation

Proceed with a Phase 1 proof of concept on the Storefront codebase:

- **Tool:** Claude Code via the official GitLab CI/CD integration.
- **Pattern:** Child pipeline triggered by the main MR pipeline; single agent execution for the POC.
- **Trigger:** MR Draft → Ready, with `@claude` mention available in draft.
- **Scope:** One agent, code quality and framework patterns combined lens.
- **Output:** Inline threads with file/line references, severity tags, capped at 10 per MR, Critical/High only.
- **Posture:** Advisory; `allow_failure: true`.
- **Measurement:** Dashboard from day one, with weekly review and monthly leadership reporting.
- **Cohort:** 3–5 volunteer teams / engineers for 4–6 weeks.
- **Investment:** ~1.5 weeks senior engineering setup time + ~AUD 300–500 tooling cost.
- **Governance:** Named capability owner, architect-level sponsor, CIO visibility at quarterly review.

Phase 2 transitions the architecture to orchestrator + sub-agents and expands cohort to all Storefront engineers. Phase 3 adds specialised sub-agents based on Phase 1–2 evidence. The pattern is portable to self-hosted GitLab projects when ready for organisation-wide rollout.

This delivers a low-risk, measurable path to AI-assisted engineering quality that complements Datadog rather than duplicating it, scales across the organisation without per-team reinvention, and maintains organisational control through version-controlled prompts, defined governance and explicit stop conditions.
