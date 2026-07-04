---
type: Architecture Decision Record (ADR)
status: Accepted
date: 2026-07-04
supersedes: ADR-0001
related:
  - docs/architecture/decisions/ADR-0002-work-storage-and-tracking.md
  - docs/architecture/runtime-convergence-spike.md
  - docs/architecture/crews-migration.md
  - ../cp/crew-strategy.md
---

# ADR-0003 — Rent durable execution substrate; consume catalogue personas

## Context

`crews/delivery-*` vendors persona prompts and skills locally while `digital-agency`
ships the same personas as plugins. ADR-0001 proposed hand-building turn-level
checkpointing in Crew-owned SQLite — the borrow-not-build stance in
`crew-strategy.md` rejects that path now that durable workflow, sandbox, channels,
and evals harness are commodity.

Interactive squads (Sprints 1–3) proved catalogue personas on website, content, and
SEO work. Sprint 4 scopes runtime convergence: one unattended website story on rented
substrate with catalogue agents — no vendoring in `crews/`.

## Decision

1. **Supersede ADR-0001.** Do not implement Crew-owned turn-level checkpointing as the
   primary durability engine. Reserve thin orchestration in `@carinyaparc/crew` for
   deterministic sequencing, artefact convergence, DoD gate, and workspace contract only.

2. **Rent the substrate** per `crew-strategy.md` §2 requirements: durable workflow,
   provider-agnostic agent SDK, sandbox, channels, human-in-the-loop, evals harness.
   Product selection is confirmed by the website-squad spike — provisional candidate:
   Cursor Cloud Agents + GitHub Issues (already wired in Sprint 3 deploy script).

3. **Consume catalogue personas.** `crews/delivery-*` stop reading `personaSkillsDir`
   vendored copies; resolve prompts and bundled skills from `digital-agency/agents/<slug>/`
   via instance config (`carinyaparc/config/plugins.json`, `config/deployments/`).

4. **Tracker alignment.** Interactive squads use GitHub Issues per ADR-0002. Retire
   Jira polling in `delivery-build` when spike passes; adapt GitLab MR flow to GitHub PR
   for website target or wrap via github MCP.

5. **Phased deletion.** Hand-built v2 runtime code (SQLite story store, Jira/GitLab
   integrations, vendored persona dirs) is deleted only after Phase 1 exit in
   `crew-strategy.md` — spike first, then rebuild crews on rented substrate.

## Consequences

- Benefit: Single source of truth for personas — squads and crews share `digital-agency`.
- Benefit: Deploy script (`deploy-squad-agents.sh`) schedules the same agents interactively proven.
- Trade-off: Spike may revise substrate choice; adapters required for provider neutrality.
- Trade-off: `delivery-build` Jira path remains until GitHub adapter ships post-spike.
- Trade-off: Steward Instagram cadence stays on Fly.io until social ritual added to deployments.

## Confirmation

Spike passes when one website story runs unattended:

`design.md` → GitHub issue → branch → PR → structural code review → done,

using catalogue agents only, auditable artefact trail, no direct push to `main`.
Document lines deleted from v2 runtime in `crews-migration.md`.

## Alternatives considered

- **ADR-0001 Option C (Crew-owned checkpoint log)** — rejected as primary; SDK session
  resume retained as conversation layer only.
- **Keep vendoring personas in crews** — rejected; drift from catalogue already observed.
- **Big-bang re-platform before spike** — rejected; spike validates substrate first.

---

_Spike design: [runtime-convergence-spike.md](../runtime-convergence-spike.md).
Migration map: [crews-migration.md](../crews-migration.md)._
