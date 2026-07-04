# Instance config

Single source of truth for Carinya Parc instance wiring. Target repos carry a minimal
`.carinyaparc/target.json` pointer back here.

## Files

| File | Purpose |
| ---- | ------- |
| [`instance.json`](instance.json) | Instance id, catalogue marketplace, brand paths, tracker, labels |
| [`targets/website.json`](targets/website.json) | Website artefact paths, default squad, charter links |
| [`plugins.json`](plugins.json) | Enabled agents and connectors from `digital-agency` |

## Resolution

1. Target repo `.carinyaparc/target.json` → `{ "instance": "carinyaparc", "target": "website" }`
2. Load `config/instance.json` for brand paths and tracker
3. Load `config/targets/{target}.json` for repo-local artefact paths
4. Brand files at `brand/*` (paths relative to this repo root)

## Plugin settings

`plugins.json` drives `../.claude/settings.json`. Install the catalogue marketplace
once in Cursor Settings → Plugins: `https://github.com/carinyaparc/digital-agency`.

## Related

- [`../brand/`](../brand/) — voice, taxonomy, hashtags, seasonal calendar
- [`../squads/`](../squads/) — squad charters
