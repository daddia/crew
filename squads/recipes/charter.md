# Squad C — Recipes

## Mission

Own the recipes section and **Recipes** Payload collection schema, routes, and structured
data — not editorial recipe content (Squad D).

## Roster

| Agent                      | Role                                      |
| -------------------------- | ----------------------------------------- |
| `frontend-engineer`        | Recipe UI, routes, collection integration |
| `senior-frontend-engineer` | Peer review                               |
| `qa-engineer`              | Validation                                |

Delivery chain for larger epics: add `delivery-lead`, `principal-frontend-engineer`.

## Target repo paths

| Area               | Path                                            |
| ------------------ | ----------------------------------------------- |
| Recipes collection | `website/apps/site/src/collections/Recipes.ts`  |
| Recipe routes      | `website/apps/site/src/app/(frontend)/recipes/` |
| Structured data    | recipe JSON-LD in route/layout components       |

## Backlog area

- Label: `squad:recipes`
- Project Squad field: `recipes`

## Cadence

Two-week sprints aligned with Squad A planning.

## Definition of done

- AC in epic `tasks.md` met
- Code review passed; CI green
- Recipe index, detail pages, and structured data verified on preview

## Escalation

Content disputes with Squad D → delivery-lead. SEO structured-data recommendations from
Squad E → issues labelled `type:seo-recommendation` + `squad:recipes`.
