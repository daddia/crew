# Runtime convergence spike — website squad

Design doc for ADR-0003 spike: one website story unattended on rented substrate with
catalogue personas.

## Goal

Prove define → configure → deploy layers (Sprint 3) extend to **unattended code delivery**
without vendored personas in `crews/`.

## Story (spike scope)

Single maintenance task from an existing epic — e.g. `CP08-01` or next `squad:site` issue:

| Step | Agent (catalogue) | Artefact |
| ---- | ----------------- | -------- |
| 1 | `principal-architect` or pre-approved `design.md` | Skip if design exists |
| 2 | `delivery-lead` | GitHub issue with `squad:site`, links to `tasks.md` row |
| 3 | `frontend-engineer` `implement` | Branch + code |
| 4 | `frontend-engineer` `create-mr` | PR — never push to `main` |
| 5 | `senior-frontend-engineer` `code-review` | Review verdict on PR |
| 6 | Human | Merge PR |
| 7 | `qa-engineer` `exploratory-pass` | Post-deploy check (optional in spike) |

**Out of spike:** multi-epic sprint, Steward social, Squads B/C feature epics.

## Substrate (provisional)

| Layer | Sprint 3 wiring | Spike use |
| ----- | --------------- | --------- |
| Scheduled agents | `deploy-squad-agents.sh` + `config/deployments/` | Manual "run now" for `frontend-engineer` on labelled issue |
| Tracker | GitHub Issues + org Project (ADR-0002) | Issue created by delivery-lead ritual or spike script |
| Repos | `website` + `carinyaparc` multi-repo Cursor env | `.cursor/environment.json` on website |
| Personas | `managed-agents/<slug>/` cookbooks | No copies under `crews/` |

Confirm or revise substrate after first unattended PR lands.

## Evidence from interactive sprints

| Sprint | Evidence |
| ------ | -------- |
| 1 | Squad charters, brand resolution, webops-engineer, work-storage ADR |
| 2 | Content/SEO agents, Payload seeds, Squads D/E board issues |
| 3 | Deploy script dry-run/apply, weekly-planning ritual, deployment manifests |
| 4 | Evals + strict frontmatter on delivery-chain and content skills |

## Pass criteria

1. Cursor Cloud Agent (or equivalent) picks up `squad:site` issue without IDE session.
2. PR opened with task id and epic path in description.
3. Code review agent produces blocking/non-blocking verdict referencing `tasks.md` AC.
4. Audit trail: issue → branch → PR → review comments reconstructable.
5. `crews/delivery-build` did not run — spike uses catalogue + deploy path only.

## Fail / revise triggers

- Agent pushes to `main` → block; fix deployment read-only flags
- Agent duplicates Gherkin in issue body → reinforce ADR-0002 prompt in cadence
- Substrate cannot resume after crash → evaluate durable workflow candidate (Temporal/Inngest)

## Next after spike

1. Enable `weekly-planning` schedule (Sprint 3.4 remainder)
2. Wire `delivery-build` GitHub adapter; retire Jira poller
3. Delete vendored persona dirs per `crews-migration.md`
4. Extend deployments to Squads B/C blog/recipes epics
