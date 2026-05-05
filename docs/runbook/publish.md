---
type: Runbook
version: '0.1'
status: Active
---

# Publish Runbook

Manual publish steps for `@daddia/crew`.

---

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js ≥ 24 | Match the version used in the repo |
| pnpm ≥ 10 | `npm i -g pnpm` if missing |
| npm CLI | Bundled with Node; used for `npm publish` |
| npm account | Must be a member of the `@daddia` npm org with **publish** rights |
| `NPM_TOKEN` | Automation token (type: **Publish**) from npmjs.com → Access Tokens |

To request org access, contact a `@daddia` org owner on npmjs.com. Read access for install (CREW-56-008) requires an **Automation** token with read-only scope.

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

Confirm `packages/crew/dist/` exists and contains `index.js`,
`index.d.ts`, `webhooks/index.js`, and `webhooks/index.d.ts`.

```sh
ls packages/crew/dist/
ls packages/crew/dist/webhooks/
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

```
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access
+ @daddia/crew@0.1.0
```

---

## 5. Verify

From a separate directory (outside the monorepo):

```sh
mkdir /tmp/crew-verify && cd /tmp/crew-verify
npm init -y
npm install @daddia/crew@0.1.0
```

Confirm both entry points resolve:

```sh
node --input-type=module <<'EOF'
import { resolveSession } from "@daddia/crew";
import { verifySignature } from "@daddia/crew/webhooks";
console.log("resolveSession:", typeof resolveSession);
console.log("verifySignature:", typeof verifySignature);
EOF
```

Expected:

```
resolveSession: function
verifySignature: function
```

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

| Role | Token type | Scope needed |
| --- | --- | --- |
| Package publisher (this runbook) | Automation — Publish | `@daddia` org, `@daddia/crew` package |
| CI pipeline (CREW-56-007) | Automation — Publish | `@daddia` org, stored as `NPM_TOKEN` secret |
| Agent consumer / install (CREW-56-008) | None — public package | `npm install @daddia/crew` with no token |

All tokens are created at [npmjs.com → Access Tokens](https://www.npmjs.com/settings/tokens).

---

## Version policy (until CREW-56-007)

Bump `packages/crew/package.json` → `version` manually before each release.
Follow semver: breaking API changes → major, new exports → minor, fixes →
patch. Once Changesets (CREW-56-007) is in place, version bumps are
automated via changeset files.
