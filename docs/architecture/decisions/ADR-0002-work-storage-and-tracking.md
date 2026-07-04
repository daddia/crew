---
type: Architecture Decision Record (ADR)
status: Accepted
date: 2026-07-04
supersedes:
---

# ADR-0002 — Work storage and issue tracking

## Context

Interactive squads (A–E) need a shared contract for where acceptance criteria live,
how sprint work is queued, and which repo owns which artefacts. The catalogue skills
assume markdown definitions (`docs/product/backlog.md`, `docs/work/{epic}/tasks.md`)
and a project tracker for execution status. Without an explicit decision, agents
duplicate Gherkin in issues or treat the tracker as the source of truth for scope.

## Decision

Adopt a **two-layer model**:

| Layer | System of record | Contents |
| ----- | ---------------- | -------- |
| **Contract** | Markdown in git | Epics (`docs/product/backlog.md`), Gherkin AC (`docs/work/{epic}/tasks.md`), design (`design.md`), sprint plans (`docs/work/sprint-{id}/plan.md`), retrospectives |
| **Queue** | GitHub Issues + org Project | Status, assignment, board columns — one issue per committed task at sprint planning |

**Canonical AC lives in `tasks.md`.** Issues carry title, squad label, type label,
links to epic slug and task id — not duplicated Gherkin.

### Tracker: GitHub Issues (Sprint 1)

Use **GitHub Issues** on target repos with the org-level **Carinya Parc Delivery**
Project (Team backlog template). Revisit Linear when cross-repo board needs exceed
GitHub Projects (website + carinyaparc + steward).

### Issue ↔ epic mapping

Each sprint issue includes in its body:

```markdown
Epic: docs/work/{epic-slug}/
Task: {TASK-ID} (row in tasks.md)
AC: see tasks.md — do not paste Gherkin here
```

Title format: `[{TASK-ID}] {short title}`.

Labels:

| Label | Purpose |
| ----- | ------- |
| `squad:site` … `squad:seo` | Owning squad |
| `type:feature`, `type:maintenance`, `type:defect`, `type:seo-recommendation` | Work type |

Project **Squad** field mirrors squad labels for board views.

### Artefact ownership

| Artefact | Repo | Path |
| -------- | ---- | ---- |
| Product steering (backlog, roadmap, product) | Target repo (website first) | `website/docs/product/` |
| Architecture (solution, ADRs) | Target repo | `website/docs/architecture/` |
| Epic design + tasks + verification | Target repo | `website/docs/work/{epic}/` |
| Sprint plans + retros | Target repo | `website/docs/work/sprint-{id}/` |
| Instance-wide cadence, content calendar | carinyaparc | `carinyaparc/docs/` or squad charter paths |
| Brand voice, taxonomy, hashtags, seasonal calendar | carinyaparc | `carinyaparc/brand/` (paths in `config/instance.json`) — **never** `website/docs/brand/` |
| Instance config (plugins, targets, tracker) | carinyaparc | `carinyaparc/config/` |

Squads A/B/C engineering epics use `website/docs/work/`. Squad D content calendar
may live in `carinyaparc/docs/product/content-calendar.md` (per charter). Squad E
keyword research uses `website/docs/work/seo/`.

## Consequences

- Benefit: Agents and humans share one AC source; issues stay lightweight.
- Benefit: GitHub MCP connector works without extra setup for Sprint 1 proof.
- Trade-off: Cross-repo visibility requires linked repos on one Project or manual
  coordination until Linear migration.
- Trade-off: `crews/delivery-build` Jira polling remains until runtime converges (Sprint 4).

## Confirmation

Sprint 1.4 succeeds when: sprint plan references `tasks.md` rows; issues link back
without pasted Gherkin; 2–3 PRs merge against committed AC; retro documents friction.

## Alternatives considered

- **Linear only**: Better cross-repo board; deferred — website-first proof on GitHub.
- **Jira only**: Continuity with delivery-build crew; rejected for interactive squads —
  adds friction for Cursor/Cowork workflows already wired to GitHub MCP.
- **Issues as AC source**: Rejected — Gherkin in issues drifts from design docs and
  breaks skill path conventions.
