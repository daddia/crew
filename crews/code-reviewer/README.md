# crew: code-reviewer

A publishable CLI crew that reviews GitLab merge requests using the Claude Agent SDK. It runs to completion and exits — no server, no database, no webhook handlers.

## What it does

1. Reads MR context from GitLab CI environment variables.
2. Fetches the MR diff and metadata from the GitLab API.
3. Runs the `code-quality` agent against the diff.
4. Filters findings by severity threshold and caps inline threads at 10.
5. Posts inline discussion threads anchored to file and line, plus a summary comment.
6. Exits 0 (advisory — never blocks the pipeline).

## Installing in a consuming repo

Add to `.gitlab-ci.yml`:

```yaml
ai-review:
  stage: review
  image: node:24-alpine
  rules:
    - if: $CI_MERGE_REQUEST_EVENT_TYPE == 'merge_request_event'
      when: on_success
  variables:
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
    GITLAB_TOKEN: $AI_REVIEWER_BOT_TOKEN
  script:
    - npx -y @daddia/crew-code-reviewer@^1
  allow_failure: true
```

Configure project-specific standards in a `CLAUDE.md` at the consuming repo root. Standards shipped with the package (framework patterns, severity rubric, output format) apply to all consumers. Repo-level `CLAUDE.md` additions are merged at runtime.

## Running locally

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY, GITLAB_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID

cd ../../         # workspace root
pnpm install
pnpm build

cd crews/code-reviewer
pnpm start
```

## Running tests

```bash
pnpm test
```

## Environment variables

See [.env.example](.env.example) for all variables. In CI, `CI_PROJECT_ID` and `CI_MERGE_REQUEST_IID` are injected automatically by GitLab.

## Behaviour controls

| Variable | Default | Description |
|---|---|---|
| `MAX_FINDINGS` | `10` | Hard cap on inline threads per MR |
| `SEVERITY_THRESHOLD` | `high` | Minimum severity posted inline (`critical`, `high`, `medium`, `low`, `note`) |
| `DIFF_FILE_CAP` | `50` | MRs with more files than this receive a refusal comment instead of review |

## MCP servers

Only `gitlab` is configured — read-only access to MR data and repository files. See [mcp.json](mcp.json).

## Adding a review lens (Phase 2)

1. Create `src/agents/<lens-name>/` following the `code-quality` layout.
2. Write `agent.ts` (read-only `ALLOWED_TOOLS` only), `prompt.md`, and skills.
3. Import and invoke the new agent in `src/orchestrator.ts`.
4. Aggregate its findings into the shared `Finding[]` before passing to the poster.

## Publishing

```bash
pnpm build
npm publish --access public   # or to your private registry
```

Bump `version` in `package.json` following semver. A prompt change that changes review behaviour is a `minor` bump; a breaking output-format change is `major`.
