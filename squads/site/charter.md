# Squad A — Site

## Mission

Own platform health, dependencies, performance, monitoring, and cross-cutting site
maintenance on the **website** repository.

## Roster (catalogue agents)

| Agent | Role |
| ----- | ---- |
| `delivery-lead` | Sprint planning, routing, retros |
| `principal-architect` | Solution, ADRs, epic design |
| `frontend-engineer` | UI implementation |
| `senior-frontend-engineer` | Peer code review |
| `principal-frontend-engineer` | Final technical gate |
| `qa-engineer` | Post-CI validation |
| `webops-engineer` | CI/CD, deps, platform health, deploy |

## Target repo paths

| Area | Path |
| ---- | ---- |
| Monorepo root | `website/` |
| Site app | `website/apps/site/` |
| CI | `website/.github/workflows/` |
| Product steering | `website/docs/product/` |
| Epic work | `website/docs/work/{epic}/` |
| Architecture | `website/docs/architecture/` |

## Backlog area

- Label: `squad:site`
- Project Squad field: `site`
- Epics in `website/docs/product/backlog.md` tagged Site / platform / CP08 performance / monitoring

## Cadence

Two-week sprints. Weekly planning with product-manager + delivery-lead. Daily standup
digest (Sprint 3 automation).

## Definition of done

- AC in `tasks.md` met
- Peer + final code review passed
- CI green; Vercel preview verified
- QA exploratory pass on deployed preview
- Issue closed; retro notes captured

## Escalation

Architecture decisions → principal-architect ADR. Production incidents → webops-engineer
+ human. Cross-squad SEO fixes → hand off to owning squad (B/C) via labelled issue.
