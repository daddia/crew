# Weekly planning ritual

**Agents:** `product-manager` (backlog refine) → `delivery-lead` (sprint plan)  
**Schedule:** Monday 08:00–09:00 AEST (see `config/deployments/weekly-planning-*.json`)  
**Output:** PR to `website/docs/work/sprint-{n}/plan.md` + GitHub issues per squad

## Preconditions

1. Multi-repo workspace: `website` + `carinyaparc` (brand and instance config).
2. Read `website/docs/product/backlog.md` and open epic `tasks.md` files.
3. Read `carinyaparc/config/instance.json` for tracker labels.
4. Never push directly to `main` — always open a PR for review.

## Phase 1 — Product manager (`backlog` refine)

1. Invoke `backlog` skill in **refine** mode against `website/docs/product/backlog.md`.
2. Confirm epic priorities align with roadmap Phase 1/2 exit criteria.
3. Flag blockers and open questions as comments on the planning PR (not new epics unless agreed).
4. Do not duplicate Gherkin AC in issues — link epic slug + task id only.

## Phase 2 — Delivery lead (`sprint` plan)

1. Invoke `sprint` skill in **plan** mode.
2. Select committed tasks from epic `tasks.md` rows for the upcoming sprint.
3. Write `website/docs/work/sprint-{nn}/plan.md` (increment sprint id from last folder).
4. Create GitHub issues on `carinyaparc/website`:
   - Title: task summary
   - Labels: `squad:{site|blog|recipes|content|seo}`, `type:feature|maintenance|defect`
   - Body: link to `docs/work/{epic}/tasks.md` + task id (e.g. `CP09-01`)
5. Open one PR containing the sprint plan markdown only.

## Acceptance

- [ ] Sprint plan PR is reviewable (not merged by agent)
- [ ] Each committed task has a matching labelled issue
- [ ] No Gherkin duplicated in issue bodies
- [ ] Brand still resolves from `carinyaparc/brand/` (no `docs/brand/` on website)
