# Delivery Build Crew (`delivery-build`)

The `delivery-build` crew runs the autonomous build and peer-review loop for a single Jira story, then hands off to the downstream QA crew. This README is the **canonical reference** for this crew's environment, configuration, and local workflow. Operating procedures (deploy, monitor, recover) live in [`docs/runbook/delivery-build.md`](../../docs/runbook/delivery-build.md); the contract this crew implements lives in [`docs/design/crew-flows/delivery-build.md`](../../docs/design/crew-flows/delivery-build.md).

## What it does

1. Polls Jira every `POLL_INTERVAL_MS` for `To Do` stories assigned to `JIRA_ASSIGNEE_ACCOUNT_ID` (primary trigger); also accepts `POST /webhooks/jira` (secondary).
2. Fetches full ticket context (`summary`, `description`) before implementation begins.
3. `engineer` assesses clarity; pauses for a PM response if the ticket is ambiguous.
4. `engineer` implements the story on a feature branch.
5. `senior-engineer` performs a peer code review.
6. `engineer` addresses feedback — bounded to `REFACTOR_LOOP_CAP` iterations.
7. `engineer` opens a GitLab MR after peer review approves.
8. CI pipeline is monitored; `engineer` fixes failures up to `CI_RETRY_CAP` times.
9. Jira ticket is transitioned to "In QA" once the pipeline is green; a `ready-for-qa` event is logged.

On loop-cap exhaustion or any unrecoverable failure, the ticket transitions to "Needs human review" with a summary of unresolved items. Human feedback injected as MR comments is handled by `POST /webhooks/gitlab`, which resumes the address-feedback loop.

## Requirements

**Node.js ≥ 24.15.0.** The state store uses the built-in `node:sqlite` module (`DatabaseSync`).

## Environment variables (canonical reference)

[`src/config.ts`](src/config.ts) is the authoritative schema; this table mirrors it for human reference. [`.env.example`](.env.example) is a fill-in-the-blanks rendering grouped by Identity / Behaviour / Infrastructure / Secrets.

### Required

| Variable                       | Description                                                      |
| ------------------------------ | ---------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`            | Anthropic API key                                                |
| `ATLASSIAN_EMAIL`              | Atlassian account email                                          |
| `ATLASSIAN_API_TOKEN`          | Atlassian API token                                              |
| `ATLASSIAN_BASE_URL`           | e.g. `https://yourorg.atlassian.net`                             |
| `JIRA_PROJECT_KEY`             | Jira project key (e.g. `CREW`)                                   |
| `JIRA_ASSIGNEE_ACCOUNT_ID`     | Jira account ID of the engineer this crew picks stories for      |
| `GITLAB_PERSONAL_ACCESS_TOKEN` | GitLab PAT with `api` scope                                      |
| `GITLAB_API_URL`               | e.g. `https://gitlab.com/api/v4`                                 |
| `GITLAB_PROJECT_ID`            | Numeric project ID                                               |
| `JIRA_WEBHOOK_SECRET`          | Shared secret for Jira webhook HMAC verification                 |
| `GITLAB_WEBHOOK_SECRET`        | Shared token for GitLab webhook verification                     |
| `DB_PATH`                      | SQLite file path (e.g. `/data/delivery-build.db` in production)  |
| `PROJECT_DIR`                  | Absolute path to the repository root for engineer memory seeding |

### Optional

| Variable                       | Default             | Description                                                                                                        |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `MODEL_ROUTING_LOW_COST`       | `claude-sonnet-4-6` | Model for triage and peer review (`assess-clarification`, `peer-code-review`)                                      |
| `MODEL_ROUTING_IMPLEMENTATION` | `claude-opus-4-5`   | Model for implementation and remediation (`implement-story`, `address-feedback`, `fix-ci`)                         |
| `POLL_INTERVAL_MS`             | `300000`            | Milliseconds between Jira polling ticks                                                                            |
| `REFACTOR_LOOP_CAP`            | `2`                 | Max peer-review iterations before escalation                                                                       |
| `CI_RETRY_CAP`                 | `3`                 | Max CI fix attempts before escalation                                                                              |
| `CI_POLL_INTERVAL_MS`          | `30000`             | Milliseconds between CI pipeline polls                                                                             |
| `CI_WAIT_TIMEOUT_MS`           | `1800000`           | Maximum milliseconds to wait for a pipeline to settle before escalating                                            |
| `CLARIFICATION_TIMEOUT_HOURS`  | `24`                | Hours to wait for PM clarification before escalating                                                               |
| `ATLASSIAN_ACCOUNT_ID`         | —                   | Bot account ID for reliable bot-vs-human comment detection (falls back to `ATLASSIAN_EMAIL` comparison when unset) |
| `DIFF_FILE_CAP`                | `50`                | Maximum number of files included in an MR diff sent to the agent                                                   |
| `DIFF_SIZE_CAP_BYTES`          | `500000`            | Maximum byte size of an MR diff sent to the agent                                                                  |

## Running locally

```bash
cp .env.example .env
# fill in values

cd ../../          # workspace root
pnpm install && pnpm build

cd crews/delivery-build
pnpm start
```

## Running tests

```bash
pnpm test
```

## MCP servers

MCP server definitions live in [`mcp.json`](mcp.json). The crew starts `atlassian` and `gitlab` as child processes at session start.

## Extending the crew

- **Add a skill** — create `src/agents/<persona>/plugin/skills/<skill-name>/SKILL.md`. `readSkillsDir()` picks it up at agent start; no other wiring needed.
- **Add a persona** — follow [`contributing/adding-a-persona.md`](../../contributing/adding-a-persona.md). Wire the new agent into [`src/workflow.ts`](src/workflow.ts) and add a tool-scoping assertion in `tests/agent-tool-scoping.test.ts`.

## Operating in production

Deploy + monitor + recover procedures live in [`docs/runbook/delivery-build.md`](../../docs/runbook/delivery-build.md). Local container build + smoke test: [`docs/runbook/container.md`](../../docs/runbook/container.md).
