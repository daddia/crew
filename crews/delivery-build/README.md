# Delivery Build Crew (`delivery-build`)

The `delivery-build` crew runs the autonomous build and peer-review loop for a story, then hands off to `delivery-qa`.

## What it does

1. Polls Jira every `POLL_INTERVAL_MS` for `To Do` stories assigned to `JIRA_ASSIGNEE_ACCOUNT_ID` (primary trigger); also accepts `POST /webhooks/jira` as a secondary trigger.
2. Fetches full ticket context (`summary`, `description`) before implementation begins.
3. `engineer` implements the story on a feature branch.
4. `senior-engineer` performs a peer code review.
5. `engineer` addresses feedback (bounded to `REFACTOR_LOOP_CAP` iterations).
6. `engineer` opens a GitLab MR after peer review approves.
7. CI pipeline is polled; `engineer` fixes failures up to `CI_RETRY_CAP` times.
8. Jira ticket is transitioned to "In QA" once the pipeline is green.

On loop cap exceeded (or any unrecoverable failure), the ticket transitions to "Needs human review" with a comment summarising unresolved items.

Human feedback injected as MR comments is handled by `POST /webhooks/gitlab`, which resumes the address-feedback loop.

## Deploying to Railway

`railway.json` lives alongside this crew. Because the Dockerfile copies from `packages/` and `tooling/`, it needs the **repository root** as its Docker build context. Configure the Railway service with two settings:

| Dashboard field  | Value                                   |
| ---------------- | --------------------------------------- |
| Root Directory   | _(leave blank — defaults to repo root)_ |
| Config File Path | `crews/delivery-build/railway.json`     |

**Required environment variables** (set in the Railway service dashboard):

| Variable                       | Description                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`            | Anthropic API key                                                                                                                                      |
| `ANTHROPIC_MODEL`              | Claude model override (optional; SDK default when not set)                                                                                             |
| `ATLASSIAN_EMAIL`              | Atlassian account email                                                                                                                                |
| `ATLASSIAN_API_TOKEN`          | Atlassian API token                                                                                                                                    |
| `ATLASSIAN_BASE_URL`           | e.g. `https://yourorg.atlassian.net`                                                                                                                   |
| `JIRA_PROJECT_KEY`             | Jira project key (e.g. `CREW`)                                                                                                                         |
| `JIRA_ASSIGNEE_ACCOUNT_ID`     | Jira account ID of the engineer assigned to incoming stories                                                                                           |
| `GITLAB_PERSONAL_ACCESS_TOKEN` | GitLab PAT with `api` scope                                                                                                                            |
| `GITLAB_API_URL`               | e.g. `https://gitlab.com/api/v4`                                                                                                                       |
| `GITLAB_PROJECT_ID`            | Numeric project ID                                                                                                                                     |
| `JIRA_WEBHOOK_SECRET`          | Shared secret for Jira webhook HMAC verification                                                                                                       |
| `GITLAB_WEBHOOK_SECRET`        | Shared token for GitLab webhook verification                                                                                                           |
| `DB_PATH`                      | Set to `/data/delivery-build.db` (matches the volume mount below)                                                                                      |
| `PROJECT_DIR`                  | Absolute path to the repository root for engineer memory seeding                                                                                       |
| `POLL_INTERVAL_MS`             | Optional; ms between Jira polling ticks, defaults to `300000`                                                                                          |
| `REFACTOR_LOOP_CAP`            | Optional; max peer-review iterations before escalation, defaults to `2`                                                                                |
| `CI_RETRY_CAP`                 | Optional; max CI fix attempts before escalation, defaults to `3`                                                                                       |
| `CI_POLL_INTERVAL_MS`          | Optional; ms between CI pipeline polls, defaults to `30000`                                                                                            |
| `CLARIFICATION_TIMEOUT_HOURS`  | Optional; hours to wait for PM clarification before escalating, defaults to `24`                                                                       |
| `ATLASSIAN_ACCOUNT_ID`         | Optional; Jira account ID of the bot account, used for reliable bot-vs-human comment detection (falls back to `ATLASSIAN_EMAIL` comparison when unset) |
| `DIFF_FILE_CAP`                | Optional; maximum number of files included in a MR diff sent to the agent, defaults to `50`                                                            |
| `DIFF_SIZE_CAP_BYTES`          | Optional; maximum byte size of a MR diff sent to the agent, defaults to `500000`                                                                       |

**Persistent volume** — the SQLite database must survive redeploys. Railway does not support volume configuration in `railway.json`; provision the volume once via the CLI or dashboard before first deploy:

```sh
# One-time setup — run after `railway link` has associated the CLI with the service.
railway volume add --mount-path /data
railway variables set DB_PATH=/data/delivery-build.db
```

Or via the Railway dashboard: add a volume to the service, set the mount path to `/data`, then set `DB_PATH=/data/delivery-build.db` in the service variables.

**Webhook URLs** — after deploying, register the public URLs with Jira and GitLab:

- Jira: `https://<railway-domain>/webhooks/jira` — trigger on issue transition to "Ready for Dev"
- GitLab: `https://<railway-domain>/webhooks/gitlab` — trigger on MR note (comment) events

## Requirements

**Node.js ≥ 24.15.0.** The state store uses the built-in `node:sqlite` module
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

See [`src/config.ts`](src/config.ts) for the canonical schema and validation
rules. [`env.example`](.env.example) is a human-readable rendering of the same
schema, grouped by the four config buckets: Identity, Behaviour,
Infrastructure, and Secrets.

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
