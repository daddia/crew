# Delivery Code Review Crew (`delivery-code-review`)

> **Scaffold** — full implementation deferred until the build slice is hardened and the remote audit sink (`@daddia/crew/audit`) is in place.

The crew that will own standalone, post-MR code review across the catalogue. Its planned role in the architecture is the **CLI-shaped `code-reviewer`** — the first crew in the Next-phase catalogue that does **not** carry per-process SQLite state: it ships as a published npm package invoked in CI on every MR, runs to completion, writes findings to the system of record, and exits.

This sits **outside** the `delivery-build → delivery-qa → delivery-review` pipeline. It is a horizontal capability: any project — including those not using the delivery crews — can pull it in as `npx @daddia/crew-delivery-code-review` in their CI config.

## Planned scope

1. Triggered by the host's CI pipeline (e.g. on MR open / push to MR branch).
2. Reads the diff, the linked story (if any), and the project's `AGENTS.md`.
3. Applies the same code-quality rubric the `delivery-build` senior-engineer uses, scoped to a post-MR vantage point.
4. Posts findings as MR notes; sets a CI status check based on the verdict.
5. Writes an audit envelope to the remote audit sink at exit.

## Status

| Component | Status |
|-----------|--------|
| `src/index.ts` | Scaffold placeholder (no workflow wired) |
| `cli.ts` entry point | Not yet added |
| Personas | Not yet added |
| Remote audit sink (`@daddia/crew/audit`) | Not yet shipped — blocker |

## Why a separate crew

The senior-engineer in `delivery-build` already runs peer code review **inside** the build loop. That keeps the loop tight when the engineer and reviewer are the same crew. The post-MR `code-reviewer` is for a different audience: external consumers of the package who want autonomous code review on every MR without standing up a server-shaped crew. Both can co-exist; neither replaces the other.

See [`docs/architecture/solution.md`](../../docs/architecture/solution.md) §4.1 for the catalogue context and §10.3 for the open question about the audit-sink contract that gates this crew.
