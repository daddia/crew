# Squads — organisational config

Squads are **configuration, not code**. Each squad is a charter: mission, agent
roster, owned paths, backlog area (labels/board), cadence, and definition of done.

## Squads vs crews

| Concept | What it is | Location |
| ------- | ---------- | -------- |
| **Squad (A–E)** | Organisational config for interactive delivery | `squads/` |
| **Crew (`delivery-*`)** | Unattended runtime process (poller/webhook workflow) | `crews/` |
| **Catalogue agent** | Persona plugin consumed by squads and crews | `digital-agency/agents/` |

Squads run interactively in Claude Cowork / Cursor using the `digital-agency`
catalogue with instance config from `config/`. Crews are the unattended runtime —
a later convergence phase (see ADR-0002 work storage; runtime substrate decision
deferred to Sprint 4).

**Migration direction:** `crews/delivery-*` stop vendoring prompts/skills and consume
`digital-agency` agents instead. Squads remain stable config; `crews/` shrink as rented
substrate converges.

## Squad roster

| Squad | Slug | Charter | Primary target |
| ----- | ---- | ------- | -------------- |
| A — Site | `site` | [site/charter.md](site/charter.md) | `website` — platform, deps, performance |
| B — Blog | `blog` | [blog/charter.md](blog/charter.md) | `website` — Posts collection, blog routes |
| C — Recipes | `recipes` | [recipes/charter.md](recipes/charter.md) | `website` — Recipes collection, recipe routes |
| D — Content | `content` | [content/charter.md](content/charter.md) | Payload seed PRs + steward social craft |
| E — SEO | `seo` | [seo/charter.md](seo/charter.md) | Audits and recommendations as issues |

## Cross-squad cadence

`product-manager` + `delivery-lead` run weekly planning → backlog refinement → sprint
plan. Daily standup digest and sprint review automation follow in Sprint 3.

## Plugin set

Interactive squads use:

- **Catalogue:** `carinyaparc/digital-agency` marketplace (agents + skills + connectors)
- **Instance config:** `config/plugins.json` and `config/instance.json` in this repo
- **Brand:** `brand/` markdown (paths in `config/instance.json`)

Target repos declare the instance via `.carinyaparc/target.json` (see `website`).

## Labels and board

GitHub label prefix `squad:` maps to Project **Squad** field. Type labels (`type:feature`,
`type:maintenance`, etc.) classify work. See
[ADR-0002](../docs/architecture/decisions/ADR-0002-work-storage-and-tracking.md).
