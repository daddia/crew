---
type: Persona Cadence
scope: product
product: crew
version: '1.1'
owner: daddia
status: Current
last_updated: 2026-05-21
parent: docs/product/product.md
related:
  - docs/product/product.md
  - docs/product/roadmap.md
  - docs/product/backlog.md
  - docs/crew-flows/delivery-build.md
  - architecture/solution.md
---

# Persona Cadence -- Crew

> **Platform note (2026-05).** Delivery is splitting across multiple deployable crews (`delivery-build`, `delivery-qa`, `delivery-review`). This document describes the **full squad model**; the **Now** implementation is the build slice in [`docs/crew-flows/delivery-build.md`](../crew-flows/delivery-build.md) (engineer + senior-engineer; tech-lead final review moves to `delivery-review` when that crew ships).

Maps activities of an autonomous delivery squad onto personas, anchored in Dual Track Agile. Persona specs, workflow plans, and rubrics derive from this model.

- **Product:** [`product.md`](product.md)
- **Roadmap:** [`roadmap.md`](roadmap.md)
- **Backlog:** [`backlog.md`](backlog.md)
- **Architecture:** [`architecture/solution.md`](../../architecture/solution.md)

## 1. The Dual Track Agile model in Crew terms

Crew uses Dual Track Agile. Two tracks run in parallel within one Crew:

```
                 ┌─────────────────────────────────────────────────────┐
DISCOVERY TRACK  │  Validate the right thing to build (next sprint+)   │
                 │  Inputs:  problems, opportunities, signals          │
                 │  Outputs: validated stories ready for development   │
                 └─────────────────────────────────────────────────────┘
                                      │   feeds (when ready)
                                      ▼
                 ┌─────────────────────────────────────────────────────┐
DELIVERY TRACK   │  Build the validated thing well (current sprint)    │
                 │  Inputs:  ready stories with AC + design.md         │
                 │  Outputs: merged, deployed, accepted artifacts      │
                 └─────────────────────────────────────────────────────┘
```

A third track sits across both:

```
                 ┌─────────────────────────────────────────────────────┐
REFINE TRACK     │  Improve the system itself                          │
                 │  Inputs:  every run's provenance + drift signals    │
                 │  Outputs: retros, trend reports, doc updates        │
                 └─────────────────────────────────────────────────────┘
```

**The Tech Lead is the bridge.** The Tech Lead sits between Discovery and Delivery: they decide when a Discovery output (a groomed story with AC and, where required, a design) is "ready for development" and dispatch it into the Delivery track.

## 2. Sprint timeline (2-week sprint)

```
Day:    -1   1   2   3   4   5   6   7   8   9   10  11
        │   │   │   │   │   │   │   │   │   │   │   │
PLAN    █                                                ← sprint planning
                                                     
DELIVERY    ████████████████████████████████████        ← Tech Lead, Senior Engineer, Engineer
                                                     
DISCOVERY   ████████████████████████████████████        ← Product Manager, Software Architect
            (working on sprint+1 and sprint+2)            (Later phase)
                                                    
REFINE      ────────────────────────────────────        ← Delivery Manager (continuous monitor)
                                                          Technical Writer (event-driven)
                                                    
DEMO                                            █       ← human-led with PM artefacts
RETRO                                              █    ← Delivery Manager (Later)
GROOM                                                  █ ← Product Manager (Later)
PLAN                                                   █ ← sprint+1 planning
```

**Day -1** (sprint planning). Sprint scope frozen. Stories that survived Discovery move to "Ready for Development" in Jira. The Tech Lead validates each story's readiness as it enters the sprint.

**Days 1-10** (sprint execution). Two tracks running. Delivery on the frozen sprint scope; Discovery one or two sprints ahead.

**Day 10** (sprint close). Sprint review (humans + PM artefacts). Retrospective (Delivery Manager). Backlog refinement for next sprint (Product Manager).

## 3. Activities by persona

Each persona section names its activation pattern, what triggers it, what it does, and what it produces.

### 3.1 Tech Lead (Now; Delivery track bridge)

The squad's front door. Stays "on" continuously throughout the sprint.

**Cadence:** Continuous, event-driven.

| Trigger | Activity | Produces |
|---|---|---|
| Sprint planning completes | Read sprint backlog; validate each story has AC + design.md; mark blockers | Slack summary; Jira comments on blocked stories |
| Story ready, capacity free | Pick next story; build `WorkflowPlan` for `delivery` workflow; dispatch | Inngest `crew/workflow.requested` event |
| MR opened (own dispatch) | (Workflow continues automatically; no Tech Lead action) | -- |
| MR review-comment webhook (external human) | Decide: address loop or escalate; dispatch `address-feedback` workflow | Inngest event to address phase |
| MR merge webhook | Transition Jira; check sprint state | Jira "Awaiting Release" + Slack post |
| Slack message from human | Triage: question (answer), new ticket (assess + park / dispatch), incident (escalate) | Slack reply or dispatched workflow |
| New Jira ticket arrives mid-sprint | Triage: ready for sprint? bump to next? needs design? | Jira comment; dispatch Architect (Later) if design needed |
| Workflow escalates | Surface to humans in Slack with context | Slack alert |
| MR ready for final approval | Run `final-code-review` task; verdict drives merge or re-route to address | Review comment; approve or changes-requested |
| Sprint end | Hand off open work; signal Delivery Manager (Later) for retro inputs | Sprint summary post |

**Tasks owned:** `triage-incoming`, `dispatch-workflow`, `final-code-review`, `route-feedback`.

### 3.2 Senior Engineer (Now; Delivery track)

Senior IC. Peer-reviews every implementation; takes complex stories directly when routed by the Tech Lead.

**Cadence:** Per-story dispatch.

| Trigger | Activity | Produces |
|---|---|---|
| Engineer opens MR (workflow event) | Read diff against design.md and AC; run rubric self-evaluation; post structured peer-review verdict | Review comment with approve / changes-requested + structured feedback |
| Engineer pushes additional commits in address loop | Re-review delta | Updated review verdict |
| Tech Lead routes a complex story directly | Implement story (same task as Engineer, but the priors are senior IC) | Branch, commits, MR |

**Tasks owned:** `peer-review`, `implement-story` (when routed for complex work).

### 3.3 Engineer (Now; Delivery track)

Mid/junior IC. Implements stories against AC and design.md; addresses review feedback.

**Cadence:** Per-story dispatch.

| Trigger | Activity | Produces |
|---|---|---|
| Tech Lead dispatches `delivery` workflow | Read AC + design.md; plan implementation; code; test; build; open MR | Branch, commits, MR with template body |
| Senior Engineer requests changes | Read peer-review feedback; classify (blocker/non-blocker); apply fixes; push commits | Updated commits; resolved comments |
| External (human) MR feedback routed by Tech Lead | Same as above for external reviewer comments | Updated commits |
| Tech Lead requests changes after final review | Address final-review findings; push commits | Updated commits; back to Senior Engineer for re-review |

**Tasks owned:** `implement-story` (default), `address-feedback`.

### 3.4 Product Manager (Later; Discovery track)

Translates strategy into ready stories. Active throughout the sprint, working ahead on the *next* sprint's scope.

**Cadence:** Continuous, with periodic refinement waves (mid-sprint, end of sprint).

| Trigger | Activity | Produces |
|---|---|---|
| Stakeholder request via Slack | Frame the problem; ask clarifying questions; draft an opportunity statement | Slack thread; eventually a draft story or epic |
| Tech Lead routes "epic needs definition" | Decompose epic into stories with EARS + Gherkin AC | `backlog.md` updates with stories (or Jira mirror) |
| Beginning of week 2 | Sprint+1 backlog grooming: prioritise, refine, mark Ready for Development | Updated `backlog.md`; Jira priorities |
| End of sprint | Sprint review: write outcome summary against acceptance criteria | Sprint review note |
| Continuous | Customer/stakeholder interview synthesis (humans drive interviews; PM synthesises notes) | Insights logged into product memory |

**Tasks owned:** `groom-backlog`, `refine-stories`, `sprint-review`, `answer-product-questions`.

**Note.** There is no `write-requirements` task. Story-level AC in `backlog.md` is the requirements artifact. A separate `requirements.md` exists only for regulated or contractual contexts and is not in the default flow.

### 3.5 Software Architect (Later; Discovery track)

Provides the technical design for stories before they enter Delivery.

**Cadence:** Per-story dispatch + sprint-boundary refinement.

| Trigger | Activity | Produces |
|---|---|---|
| PM marks story "needs design" | Read product context; propose technical approach; write `design.md` | `design.md` in the story's work package |
| Architect identifies a consequential decision | Write ADR (context, options, decision, consequences) | `ADR-NNNN.md` |
| Tech Lead routes "story ready check" with design gaps | Resolve gaps or escalate to humans | Updated `design.md` or escalation |
| Tech Lead flags "architectural risk" on an MR | Run `architecture-review` task on the MR | Architecture review verdict |
| End of sprint | Architecture refinement -- consolidate WP-local ADR candidates into solution.md, archive superseded sections | Updated `solution.md`; `refine-session.md` |

**Tasks owned:** `write-design`, `write-adr`, `architecture-review`, `refine-solution`.

### 3.6 Delivery Manager (Later; Refine track)

Watches sprint health and drives improvement. Distinct from the Tech Lead -- the Tech Lead routes work, the Delivery Manager analyses how the work is going.

**Cadence:** Continuous monitoring + per-sprint ceremony + periodic trend reports.

| Trigger | Activity | Produces |
|---|---|---|
| Continuous (every run produces provenance) | Aggregate provenance: velocity, blockers, cycle time, address-loop iterations, cost per accepted feature | Live sprint dashboard |
| Mid-sprint | Sprint health check: are we on track? What's stuck? | Slack post; flagged stories |
| End of sprint | Run retrospective: synthesise what went well / what didn't / what to change; route insights to the right tracks | `retrospective.md` |
| Quarterly / per-phase | Trend analysis: velocity over time, quality trends, cost trends | Metrics report |

**Tasks owned:** `sprint-health`, `retrospective`, `trend-analysis`.

### 3.7 Technical Writer (Later; Refine track)

Closes documentation drift after milestones.

**Cadence:** Event-driven (post-merge milestones) + periodic (sprint boundary, release).

| Trigger | Activity | Produces |
|---|---|---|
| Post-merge of a milestone MR | Sweep affected docs; update READMEs, public docs, release notes | Updated docs; release notes |
| End of sprint | Consistency check across artefacts (do product/solution/backlog still agree?) | Drift report; doc PRs |
| Major release | Version-bump notes; public docs refresh | Release notes |

**Tasks owned:** `docs-sweep`, `release-notes`, `consistency-check`.

## 4. Cadence patterns summary

Three distinct activation patterns. The runtime needs to support all three.

| Pattern | Personas | Operating mode |
|---|---|---|
| **Continuous (event-stream)** | Tech Lead, Delivery Manager, Technical Writer (partial) | Persona stays "warm" on the runtime; subscribes to an Inngest event stream; fires on signal. Not a per-task one-shot. |
| **Dispatched (per-task)** | Engineer, Senior Engineer | Idle between dispatches; a `WorkflowPlan` phase invokes them; they run, publish, exit. |
| **Periodic (scheduled)** | Product Manager (refinement waves), Software Architect (sprint-boundary refinement), Delivery Manager (mid-sprint, end-of-sprint), Technical Writer (consistency checks) | Cron-driven invocation at known sprint boundaries; produces an artefact and exits. |

**Implication for the runtime.** Continuous personas need a long-running subscription model that does not exist in the per-task `executeRunCommandFromRequest` pipeline today. The Tech Lead is the first persona to require this in Now -- it must keep listening to Slack and webhooks across many tasks within a single Crew lifetime. CREW-40 carries the runtime change to support continuous personas; subsequent continuous personas (Delivery Manager, Technical Writer) reuse that surface.

## 5. Sprint ceremony ownership

Some ceremonies are owned by personas; some require humans; some are hybrid.

| Ceremony | Real-life owner | Crew owner | Notes |
|---|---|---|---|
| Sprint planning | PO + Tech Lead + team | Product Manager (proposes) + Tech Lead (validates readiness) + humans (commit) | Tech Lead's "is this ready for dev" check is the gating function |
| Daily standup | Scrum Master | None -- replaced by always-visible state in Jira + Slack + dashboards | Tech Lead's status updates substitute |
| Backlog refinement | PM + team | Product Manager (drives) + Software Architect (technical inputs) | Continuous, weighted toward week 2 of sprint |
| Sprint review / demo | PM + team | Product Manager (writes summary) + humans (demo to stakeholders) | Demo remains human-driven; PM produces the artefacts |
| Retrospective | Scrum Master / DM | Delivery Manager | Synthesises provenance + open insights |

Three ceremonies still need humans: sprint planning commit, sprint review with stakeholders, and final retrospective discussion. The personas do the heavy lifting; humans provide judgement and signal at the gates.

## 6. Discovery → Delivery handoff

The handoff path from Discovery to Delivery within one Crew:

```
Product Manager grooms a story         →  story has EARS + Gherkin AC in backlog.md
                                          (or Jira mirror)
Software Architect writes design       →  design.md exists in work/{epic}/{story}/
(only for stories that need it)
Tech Lead validates readiness          →  marks "Ready for Development"
                                          (this is the readiness check)
                                          ↓
Delivery workflow dispatched
  Engineer implements
    Senior Engineer peer-reviews
      Engineer addresses (loop)
        Tech Lead final-code-review
          Human approval
            Merge → Jira "Awaiting Release" → Done
```

The Tech Lead's readiness check is the consequential persona decision in this flow. It needs its own rubric (`is-ticket-ready.md`), and getting it right is what protects Engineers from starting work on un-ready stories.

## 7. Open decisions

These are surfaced now so the cadence can stabilise as Later opens:

1. **Designer is missing.** UX/visual design isn't a Crew persona today. Either folds into Product Manager, gets added as a separate persona, or stays human in scope. **Decision deferred to early Later.**
2. **QA is implicit.** Testing is split between Engineer (writes tests) and Senior Engineer (validates in peer review). For products with manual / exploratory testing, this is undersized. **Decision deferred to Later.**
3. **Production / on-call is human.** Crew produces artefacts but doesn't run them. Incidents return to humans. **Permanent boundary; no Crew persona owns production incidents.**
4. **Stakeholder communication is partly Tech Lead, partly Product Manager.** The boundary between "Tech Lead reads Slack and triages" and "Product Manager responds to product questions" needs to be drawn. **Decision in Later as Product Manager opens.**
5. **The Tech Lead's readiness rubric is the most consequential persona decision.** It deserves a dedicated rubric and explicit acceptance test. **Owned by CREW-40.**

## 8. Persona summary table

| Persona | Phase | Track | Cadence | Real-world prior |
|---|---|---|---|---|
| **Tech Lead** | Now | Bridge | Continuous | Strong |
| **Senior Engineer** | Now | Delivery | Dispatched | Strong |
| **Engineer** | Now | Delivery | Dispatched | Strong |
| **Product Manager** | Later | Discovery | Periodic + dispatched | Strong |
| **Software Architect** | Later | Discovery | Dispatched + sprint-boundary | Strong |
| **Delivery Manager** | Later | Refine | Continuous + per-sprint | Strong (UK / consulting orgs) |
| **Technical Writer** | Later | Refine | Event-driven + periodic | Strong |

Seven personas total. Three in Now (the operational delivery loop). Four in Later (Discovery + Refine).

## 9. Related documents

- [Crew Product](product.md) -- problem, target users, principles
- [Crew Roadmap](roadmap.md) -- phased delivery plan; persona introduction order
- [Crew Backlog](backlog.md) -- epics that deliver each persona
- [Crew Solution Architecture](architecture/solution.md) -- §6 personas and tasks; §10 orchestration; §13 deployment
