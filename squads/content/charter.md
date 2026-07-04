# Squad D — Content

## Mission

Plan editorial calendar and draft Payload content via seed PRs. Never publish or merge
without human gate. Absorbs steward social craft (captions, curation, editing).

## Roster (Sprint 2+ for strategist/writer; Sprint 1 skills land in catalogue)

| Agent                | Role                                                                | Sprint    |
| -------------------- | ------------------------------------------------------------------- | --------- |
| `content-strategist` | Content calendar, briefs                                            | 2         |
| `content-writer`     | Post/recipe seed drafts                                             | 2         |
| Skills (Sprint 1)    | `analyse-media`, `write-captions`, `edit-content`, `curate-content` | 1         |
| `brand-voice`        | Enforce voice (reads `carinyaparc/brand/` via config)               | catalogue |

## Target repo paths

| Area             | Path                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| Content seeds    | `website/apps/site/content/seeds/posts/`, `.../recipes/`                      |
| Import script    | `website/apps/site/scripts/import-content-seed.ts` (Sprint 2)                 |
| Content calendar | `carinyaparc/docs/product/content-calendar.md`                                |
| Brand            | `carinyaparc/brand/` via `config/instance.json` — never `website/docs/brand/` |

## Backlog area

- Label: `squad:content`
- Project Squad field: `content`

## Cadence

Monthly calendar planning; weekly seed PR cadence once Squad D live (Sprint 2).

## Definition of done

- Seed JSON in PR; `edit-content` + `brand-voice` pass
- Import creates Payload draft (`_status: draft`)
- Human publishes in `/admin` after editorial review

## Escalation

Technical CMS/schema → Squad B/C. SEO review → Squad E `content-seo-review`.
