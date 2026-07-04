# Crews → catalogue migration

Maps `crews/delivery-*` vendored personas to `digital-agency` agents and identifies
v2 runtime code deletable after ADR-0003 spike passes.

## Persona mapping

| Crew | Vendored persona | Catalogue agent | Bundled skills |
| ---- | ---------------- | --------------- | -------------- |
| `delivery-build` | implement persona | `frontend-engineer` | `implement`, `create-mr`, `code-review` |
| `delivery-qa` | qa-engineer | `qa-engineer` | `deploy-qa`, `exploratory-pass`, `run-automated-suite` |
| `delivery-review` | tech-lead | `senior-frontend-engineer` or `principal-frontend-engineer` | `code-review`, `final-code-review` |
| `delivery-code-review` | (scaffold) | `principal-frontend-engineer` | `final-code-review` |

Resolution: `readPromptFile` → load `agents/<slug>/agents/<slug>.md`; skills via
`sync-agent-skills.py` bundles referenced by cookbook, not `personaSkillsDir(crewRoot)`.

## Integration migration

| Current (`delivery-build`) | Target (ADR-0002) | Action |
| -------------------------- | ----------------- | ------ |
| Jira issue polling | GitHub Issues + `github` MCP | Replace poller with webhook or scheduled ingest |
| GitLab MR create/merge | GitHub PR via `create-mr` + `github` MCP | Website target is GitHub |
| Jira transitions (`In QA`, `Done`) | Project board status + labels | Map transitions to Project workflows |
| SQLite `stories` / `steps` | Rented workflow engine state | Delete after substrate carries durability |

`delivery-review` GitLab approve/merge must not run on GitHub target — review-only;
human merge gate retained.

## Deletable post-spike (Phase 1 exit)

Do not delete until spike pass + one overnight unattended run on rented substrate.

| Area | Path / component | Condition |
| ---- | ---------------- | --------- |
| Vendored skills | `crews/*/skills/` copies | Catalogue bundles wired |
| Vendored prompts | `crews/*/agents/*/prompt.md` | Cookbook paths resolve |
| Jira client | `crews/delivery-build/src/integrations/jira.ts` | GitHub adapter live |
| GitLab client | `crews/delivery-review/src/integrations/gitlab.ts` | GitHub review-only path |
| Turn checkpoint (ADR-0001) | Planned `tool_checkpoints` schema | Never implemented — drop |
| In-run SQLite durability | Per-crew story store | Replaced by rented workflow |

## Retain (thin crew layer)

| Component | Purpose |
| --------- | ------- |
| Deterministic workflow driver | Step sequence, not model-orchestrated |
| Workspace contract | Read `docs/product/`, `docs/work/{epic}/`; escalate if missing |
| DoD gate | Separate reviewer persona deployment |
| Audit / run-stream | Correlate issueKey, sessionId, artefact paths |
| Adapter interfaces | GitHub, Cursor Cloud Agents, future Linear |

## Squads vs crews (steady state)

- **Squads** — config in `squads/`, interactive or scheduled via `deploy-squad-agents.sh`
- **Crews** — thin runtime invoking same catalogue agents; shrink to adapter + orchestration
- **Steward** — Fly.io pipeline until social cadence in `config/deployments/`

## Sequencing

1. Spike: one issue → PR → review (this doc + `runtime-convergence-spike.md`)
2. GitHub poller adapter in `delivery-build` (feature flag)
3. Parallel run: Jira poller off for website repo only
4. Delete vendored persona trees
5. Remove Jira/GitLab integrations when no target repo uses them
