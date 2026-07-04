# Squad B — Blog

## Mission

Own the blog section, pages, and **Posts** Payload collection schema and routes — not
editorial content (Squad D).

## Roster

| Agent                      | Role                                    |
| -------------------------- | --------------------------------------- |
| `frontend-engineer`        | Blog UI, routes, collection integration |
| `senior-frontend-engineer` | Peer review                             |
| `qa-engineer`              | Validation                              |

Delivery chain for larger epics: add `delivery-lead`, `principal-frontend-engineer`.

## Target repo paths

| Area               | Path                                                |
| ------------------ | --------------------------------------------------- |
| Posts collection   | `website/apps/site/src/collections/Posts.ts`        |
| Blog routes        | `website/apps/site/src/app/(frontend)/blog/`        |
| Related components | `website/apps/site/src/components/` (blog-specific) |

## Backlog area

- Label: `squad:blog`
- Project Squad field: `blog`

## Cadence

Two-week sprints aligned with Squad A planning.

## Definition of done

- AC in epic `tasks.md` met
- Code review passed; CI green
- Blog routes and collection behaviour verified on preview

## Escalation

Content/schema disputes with Squad D → delivery-lead. Platform/infra → Squad A.
