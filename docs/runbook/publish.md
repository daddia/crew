---
type: Runbook
version: '0.2'
status: Active
last_updated: 2026-05-21
related:
  - packages/crew/package.json
  - .github/workflows/release.yml
---

# Publish Runbook — `@daddia/crew`

Two paths: the **Changesets-driven release pipeline** is the day-to-day path (§Changesets workflow below); the **manual steps** are an exceptional fallback when the pipeline is unavailable. Pick one — never run both for the same version.

---

## Prerequisites

| Requirement  | Notes                                                               |
| ------------ | ------------------------------------------------------------------- |
| Node.js ≥ 24 | Match the version used in the repo                                  |
| pnpm ≥ 10    | `npm i -g pnpm` if missing                                          |
| npm CLI      | Bundled with Node; used for `npm publish`                           |
| npm account  | Must be a member of the `@daddia` npm org with **publish** rights   |
| `NPM_TOKEN`  | Automation token (type: **Publish**) from npmjs.com → Access Tokens |

To request org access, contact a `@daddia` org owner on npmjs.com. `@daddia/crew` is published with public access, so no token is required to install it.

---

## 1. Authenticate

`.npmrc` is gitignored in this repo. Create it locally in the repo root before publishing; delete it after.

```sh
# Write .npmrc scoping @daddia to the public npm registry and injecting the token.
cat > .npmrc <<'EOF'
@daddia:registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
EOF

export NPM_TOKEN=<your-publish-token>
```

Verify authentication:

```sh
npm whoami --registry https://registry.npmjs.org/
# expected: your npm username

npm access list packages @daddia --registry https://registry.npmjs.org/
# expected: @daddia/crew listed (or no output if not yet published)
```

---

## 2. Build

Always build from a clean state so `dist/` matches HEAD.

```sh
# From the repo root:
pnpm install --frozen-lockfile
pnpm build
```

Confirm `packages/crew/dist/` exists and contains all subpath outputs:

```sh
ls packages/crew/dist/
ls packages/crew/dist/webhooks/
ls packages/crew/dist/config/
ls packages/crew/dist/state/
ls packages/crew/dist/workflow/
```

---

## 3. Inspect the tarball (dry run)

Run a dry publish to see exactly what will be uploaded. The `files` field in
`packages/crew/package.json` restricts the tarball to `dist/` only.

```sh
cd packages/crew
npm pack --dry-run
```

Expected output should list only files under `dist/` plus `package.json`. If `src/` or `tests/` appear, the `files` field is misconfigured — stop and fix before proceeding.

---

## 4. Publish

```sh
# Still inside packages/crew:
npm publish --access public
```

`--access public` is redundant (it matches `publishConfig.access` in `package.json`) but explicit for safety.

Expected output:

```text
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access
+ @daddia/crew@<version-in-package.json>
```

---

## 5. Verify

From a separate directory (outside the monorepo):

```sh
mkdir /tmp/crew-verify && cd /tmp/crew-verify
npm init -y
npm install @daddia/crew@latest
```

Confirm all entry points resolve:

```sh
node --input-type=module <<'EOF'
import { resolveSession } from "@daddia/crew";
import { verifySignature } from "@daddia/crew/webhooks";
import { loadEnv } from "@daddia/crew/config";
import { createSqliteStateStore } from "@daddia/crew/state";
import { createWorkflowEngine } from "@daddia/crew/workflow";
console.log("resolveSession:", typeof resolveSession);
console.log("verifySignature:", typeof verifySignature);
console.log("loadEnv:", typeof loadEnv);
console.log("createSqliteStateStore:", typeof createSqliteStateStore);
console.log("createWorkflowEngine:", typeof createWorkflowEngine);
EOF
```

Expected: all five values print as `function`.

---

## 6. Clean up

Delete the local `.npmrc` after publish:

```sh
rm /path/to/repo/.npmrc
```

Unset `NPM_TOKEN` from your shell session if you set it inline:

```sh
unset NPM_TOKEN
```

---

## Org and token reference

| Role                             | Token type            | Scope needed                                |
| -------------------------------- | --------------------- | ------------------------------------------- |
| Package publisher (this runbook) | Automation — Publish  | `@daddia` org, `@daddia/crew` package       |
| CI pipeline                      | Automation — Publish  | `@daddia` org, stored as `NPM_TOKEN` secret |
| Agent consumer / install         | None — public package | `npm install @daddia/crew` with no token    |

All tokens are created at [npmjs.com → Access Tokens](https://www.npmjs.com/settings/tokens).

---

## Changesets workflow (automated releases)

Releases for `@daddia/crew` are driven by [Changesets](https://github.com/changesets/changesets).
The manual publish steps above are only needed for exceptional one-off publishes.

### Adding a changeset to a PR

Every PR that changes `packages/crew/src/` must include a changeset file:

```sh
# From the repo root:
pnpm changeset
```

The interactive prompt asks for:

- **Which packages** are affected → select `@daddia/crew`
- **Semver bump type** → `patch` (bug fix), `minor` (new export), `major` (breaking change)
- **Summary** → one line describing the change for the `CHANGELOG.md` entry

Commit the generated `.changeset/<random-name>.md` file with the PR.

### How the release pipeline works

The `.github/workflows/release.yml` workflow runs on every push to `main`:

1. **Pending changesets exist** → the pipeline opens (or updates) a PR titled
   "chore: version packages". That PR bumps `packages/crew/package.json` version,
   collects changeset summaries into `CHANGELOG.md`, and deletes the consumed
   changeset files.
2. **The version PR is merged** → on the next push to `main`, no pending changesets
   remain. The pipeline runs `pnpm run release` (`changeset publish`), which
   publishes the new version to npm using the `NPM_TOKEN` secret.

**Required GitHub secret:** `NPM_TOKEN` — an npm Automation token with publish
rights to `@daddia/crew`. Set it at:
`Settings → Secrets and variables → Actions → New repository secret`.

### Version policy

Follow semver: breaking API changes → major, new exports → minor, fixes → patch.
Do not edit `packages/crew/package.json` → `version` by hand; let the Changesets
version PR do it.
