# Delivery Build Crew (`delivery-build`)

The `delivery-build` crew runs the autonomous build and peer-review loop for a story, then hands off to `delivery-review`.

## What it does

1. Receives a Jira "Ready for Dev" transition via `POST /webhooks/jira`.
2. `engineer` implements the story on a feature branch.
3. `engineer` opens a GitLab MR.
4. `senior-engineer` performs a peer code review.
5. `engineer` addresses feedback (bounded to `REFACTOR_LOOP_CAP` iterations).
6. Jira ticket is transitioned to "In Review" and a `ready-for-review` event is emitted as a handoff to `delivery-review`.

On loop cap exceeded (or any unrecoverable failure), the ticket transitions to "Needs human review" with a comment summarising unresolved items.

Human feedback injected as MR comments is handled by `POST /webhooks/gitlab`, which resumes the address-feedback loop.

## Deploying to Railway

`railway.json` lives alongside this crew. Because the Dockerfile copies from `packages/` and `tooling/`, it needs the **repository root** as its Docker build context. Configure the Railway service with two settings:

| Dashboard field | Value |
|---|---|
| Root Directory | *(leave blank — defaults to repo root)* |
| Config File Path | `crews/delivery-build/railway.json` |

**Required environment variables** (set in the Railway service dashboard):

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ATLASSIAN_EMAIL` | Atlassian account email |
| `ATLASSIAN_API_TOKEN` | Atlassian API token |
| `ATLASSIAN_BASE_URL` | e.g. `https://yourorg.atlassian.net` |
| `GITLAB_PERSONAL_ACCESS_TOKEN` | GitLab PAT with `api` scope |
| `GITLAB_API_URL` | e.g. `https://gitlab.com/api/v4` |
| `GITLAB_PROJECT_ID` | Numeric project ID |
| `JIRA_WEBHOOK_SECRET` | Shared secret for Jira webhook HMAC verification |
| `GITLAB_WEBHOOK_SECRET` | Shared token for GitLab webhook verification |
| `DB_PATH` | Set to `/data/delivery-build.db` (matches the volume mount below) |
| `REFACTOR_LOOP_CAP` | Optional; defaults to `2` |

**Persistent volume** — the SQLite database must survive redeploys. In the Railway dashboard, add a volume to the service and mount it at `/data`. Then set `DB_PATH=/data/delivery-build.db`.

**Webhook URLs** — after deploying, register the public URLs with Jira and GitLab:
- Jira: `https://<railway-domain>/webhooks/jira` — trigger on issue transition to "Ready for Dev"
- GitLab: `https://<railway-domain>/webhooks/gitlab` — trigger on MR note (comment) events

## Requirements

**Node.js ≥ 22.5.0.** The state store uses the built-in `node:sqlite` module
(`DatabaseSync`), which was added as an experimental API in Node 22.5.0. An
`ExperimentalWarning` is emitted at startup on Node 22; Node 23+ runs silently.

## Running locally

```bash
cp .env.example .env
# fill in values

cd ../../         # workspace root
pnpm install
pnpm build

cd crews/delivery-build
pnpm start
```

## Running tests

```bash
pnpm test
```

## Environment

See [.env.example](.env.example) for all required variables.

## MCP servers

MCP server definitions live in [mcp.json](mcp.json). The crew starts `atlassian` and `gitlab` as child processes.

## Adding a skill

1. Create a folder under `src/agents/<persona>/.claude/skills/<skill-name>/`.
2. Write `SKILL.md` — the skill is a prompt fragment, not code.
3. The agent's `agent.ts` calls `readSkillsDir` at startup; no other wiring needed.

## Adding a persona

1. `mkdir src/agents/<name>` and copy an existing persona as a template.
2. Implement `src/agents/<name>/agent.ts` following the `Agent` interface from `@daddia/crew`.
3. Wire the new agent into `src/workflow.ts`.
4. Add tool-scoping assertions to `tests/agent-tool-scoping.test.ts`.
