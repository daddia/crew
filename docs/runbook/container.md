---
type: Runbook
version: '0.1'
status: Active
last_updated: 2026-05-05
related:
  - docs/runbook/publish.md
  - crews/delivery/Dockerfile
  - docker-compose.yml
---

# Container Runbook -- Local Build and Smoke Test

Steps to build, run, and verify the `crew-delivery` container image locally.
The image installs `@daddia/crew` from the npm registry — no monorepo workspace
link is required at runtime.

---

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Docker ≥ 25 | `docker version` to confirm |
| `.env` file | Copy `crews/delivery/.env.example` to `crews/delivery/.env` and fill in values |

`@daddia/crew` is a **public** npm package. No npm token is needed to install
it; the Docker build resolves it via the public registry.

---

## 1. Prepare the environment file

```sh
cp crews/delivery/.env.example crews/delivery/.env
# Edit crews/delivery/.env — set ANTHROPIC_API_KEY, Jira, GitLab credentials, etc.
```

At minimum, the service will start and respond on `/healthz` without external
credentials. Webhook handlers and agent runs require the full set of keys.

---

## 2. Build the image

```sh
# From the repo root:
docker build -f crews/delivery/Dockerfile -t crew-delivery:local .
```

The build runs in two stages:

| Stage | What happens |
| --- | --- |
| `base` | pnpm installs `@daddia/crew@^0.1.0` from npm (no workspace source needed); TypeScript compiles `@daddia/crew-delivery` |
| `runtime` | `pnpm deploy` bundles production deps into `/deploy`; slim `node:24-slim` image runs `node dist/index.js` |

Expected final output:

```
=> exporting to image
=> => naming to docker.io/library/crew-delivery:local
```

---

## 3. Smoke test — single container

```sh
docker run --rm -p 3000:3000 --env-file crews/delivery/.env crew-delivery:local &

# Wait ~3 seconds for startup, then:
curl -s http://localhost:3000/healthz
# expected: {"ok":true}

# Teardown:
docker stop $(docker ps -q --filter ancestor=crew-delivery:local)
```

---

## 4. Smoke test — docker compose

```sh
docker compose up --build
```

The compose file mounts a named volume at `/data` for the SQLite database.
Once running:

```sh
curl -s http://localhost:3000/healthz
# expected: {"ok":true}
```

Shut down:

```sh
docker compose down
```

To wipe the database volume:

```sh
docker compose down -v
```

---

## 5. Verify `@daddia/crew` came from the registry

Confirm the installed package is the npm version, not a workspace build:

```sh
docker run --rm --entrypoint node crew-delivery:local \
  -e "const p = require('/app/node_modules/@daddia/crew/package.json'); console.log(p.version, p._resolved)"
```

Expected output contains the version and an npm registry URL:

```
0.1.0 https://registry.npmjs.org/@daddia/crew/-/crew-0.1.0.tgz
```

---

## Build args reference

| Variable | Where set | Purpose |
| --- | --- | --- |
| *(none required)* | — | `@daddia/crew` is public; no auth needed to install |
| `ANTHROPIC_API_KEY` | `.env` / runtime env | Agent model calls |
| `JIRA_WEBHOOK_SECRET` | `.env` / runtime env | Jira webhook HMAC verification |
| `GITLAB_WEBHOOK_SECRET` | `.env` / runtime env | GitLab webhook token verification |
| `DB_PATH` | `.env` / runtime env | SQLite file path (default `/data/delivery.db`) |

No secrets are needed at image build time. All credentials are injected at
`docker run` or `docker compose up` via the env file.
