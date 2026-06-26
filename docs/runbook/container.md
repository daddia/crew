---
type: Runbook
version: '0.2'
status: Active
last_updated: 2026-05-21
related:
  - docs/runbook/publish.md
  - crews/delivery-build/Dockerfile
  - docker-compose.yml
---

# Container Runbook — Local Build and Smoke Test

Steps to build, run, and verify the `delivery-build` container image locally. The image installs `@daddia/crew` from the npm registry — no monorepo workspace link is required at runtime. The same pattern applies to any future server-shaped crew; substitute the crew name in the paths and image tag.

---

## Prerequisites

| Requirement | Notes                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------ |
| Docker ≥ 25 | `docker version` to confirm                                                                |
| `.env` file | Copy `crews/delivery-build/.env.example` to `crews/delivery-build/.env` and fill in values |

`@daddia/crew` is a **public** npm package. No npm token is needed to install it; the Docker build resolves it via the public registry.

---

## 1. Prepare the environment file

```sh
cp crews/delivery-build/.env.example crews/delivery-build/.env
# Edit crews/delivery-build/.env — set ANTHROPIC_API_KEY, Jira, GitLab credentials, etc.
```

At minimum, the service will start and respond on `/healthz` without external credentials. Webhook handlers and agent runs require the full set of keys.

---

## 2. Build the image

```sh
# From the repo root:
docker build -f crews/delivery-build/Dockerfile -t crew-delivery-build:local .
```

The build runs in two stages:

| Stage     | What happens                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `base`    | pnpm installs `@daddia/crew` from npm (no workspace source needed); TypeScript compiles `@daddia/crew-delivery-build` |
| `runtime` | `pnpm deploy` bundles production deps into `/deploy`; slim `node:24-slim` image runs `node dist/index.js`             |

Expected final output:

```text
=> exporting to image
=> => naming to docker.io/library/crew-delivery-build:local
```

---

## 3. Smoke test — single container

```sh
docker run --rm -p 3000:3000 --env-file crews/delivery-build/.env crew-delivery-build:local &

# Wait ~3 seconds for startup, then:
curl -s http://localhost:3000/healthz | jq .
# expected: { "ok": true, ... }

# Teardown:
docker stop $(docker ps -q --filter ancestor=crew-delivery-build:local)
```

---

## 4. Smoke test — docker compose

```sh
docker compose up --build
```

The compose file mounts a named volume at `/data` for the SQLite database. Once running:

```sh
curl -s http://localhost:3000/healthz | jq .
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
docker run --rm --entrypoint node crew-delivery-build:local \
  -e "const p = require('/app/node_modules/@daddia/crew/package.json'); console.log(p.version, p._resolved)"
```

Expected output contains the version and an npm registry URL, e.g.:

```text
0.4.0 https://registry.npmjs.org/@daddia/crew/-/crew-0.4.0.tgz
```

---

## Build args reference

| Variable                | Where set            | Purpose                                              |
| ----------------------- | -------------------- | ---------------------------------------------------- |
| _(none required)_       | —                    | `@daddia/crew` is public; no auth needed to install  |
| `ANTHROPIC_API_KEY`     | `.env` / runtime env | Agent model calls                                    |
| `JIRA_WEBHOOK_SECRET`   | `.env` / runtime env | Jira webhook HMAC verification                       |
| `GITLAB_WEBHOOK_SECRET` | `.env` / runtime env | GitLab webhook token verification                    |
| `DB_PATH`               | `.env` / runtime env | SQLite file path (default `/data/delivery-build.db`) |

No secrets are needed at image build time. All credentials are injected at `docker run` or `docker compose up` via the env file. The full env-var reference (required vs optional and accepted values) lives in [`crews/delivery-build/README.md`](../../crews/delivery-build/README.md).
