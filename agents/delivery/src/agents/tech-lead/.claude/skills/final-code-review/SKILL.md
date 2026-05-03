# Skill: final-code-review

You are running this skill when `context.task === "final-code-review"`.

This is a **senior code review focused on architecture, cross-cutting
concerns, and delivery risk**. The peer-code-review has already passed —
line-by-line findings have been addressed. You are not re-doing that work.
You are answering a different set of questions:

- Does this change fit the existing architecture?
- Are cross-cutting concerns (logging, error surfacing, secrets, config,
  observability) handled correctly?
- Does this change put adjacent systems or shared infrastructure at risk?
- Is the MR ready to merge as-is?

AC completeness is checked separately in stakeholder-review, which follows
this step.

## Inputs

| Field | Source | Required |
|---|---|---|
| `issueKey` | top-level `AgentInput` | yes |
| `mrUrl` | `context` | yes |

## Steps

### 1. Read the MR and peer-review history

Call `mcp__gitlab__get_merge_request` for `mrUrl`. Read:

- MR title and description — are they accurate?
- Comment threads — what did the peer review raise? Were items addressed?
  Do not re-raise resolved items.
- Source branch and target branch.

### 2. Read the diff

Call `mcp__gitlab__list_merge_request_diffs`. For files where you need
broader context, call `mcp__gitlab__get_file_contents`. Focus on:

- New modules, services, or packages introduced.
- Changes to shared infrastructure (middleware, DB schema, config).
- Changes to abstraction boundaries (repositories, clients, adapters).
- New external dependencies.

### 3. Apply the architecture and cross-cutting checklist

Work through this list. Mark each item explicitly as pass, concern, or
not-applicable. Skip nothing without noting it.

#### 3.1 Architecture fit

- Does the implementation follow the established abstraction layers
  (e.g. handlers call services; services call repositories; repositories
  own DB access)?
- Does any new module or service bypass an existing abstraction that
  exists for a reason?
- Are new dependencies introduced through the project's standard
  dependency injection / factory patterns, or hardcoded?

Violations of established layers are blockers.

#### 3.2 Structured logging and observability

- New failure paths emit structured log entries at the appropriate level.
- Errors surfaced to callers contain enough context to diagnose (message,
  relevant IDs, retry-safe flag where applicable).
- No sensitive data (passwords, tokens, PII) in any log line.

Missing logging on significant new failure paths is a warning; missing
logging that would make a production incident undiagnosable is a blocker.

#### 3.3 Secrets and configuration

- All secrets read from environment variables, never hardcoded.
- New environment variables appear in `.env.example` (or equivalent).
- URLs, service names, and environment-specific values are configuration,
  not constants.

Hardcoded secrets are always blockers.

#### 3.4 New dependencies

- Is each new package trustworthy and actively maintained?
- Is it actually necessary (not already solved by an existing dependency)?
- No obvious licence conflicts with the project's licence.

Untrusted or redundant dependencies are blockers.

#### 3.5 Schema and migrations

- Schema changes have a forward migration that is idempotent and
  safe to run on a live system.
- No destructive operations (drop column, drop table) without explicit
  documentation in the MR description of the migration path.
- Migration has been reviewed for correctness against the ORM or raw SQL
  in use.

Unsafe migrations are blockers.

#### 3.6 Risk to adjacent systems

- Any shared schema, queue, event contract, or API consumed by other
  services — has it changed in a backwards-incompatible way?
- If breaking: is there a migration path and are consumers updated in
  this diff or in a coordinated deployment?

Uncoordinated breaking changes to shared contracts are blockers.

### 4. Decide

#### Approve

Conditions for approval:
- No blockers in the architecture/cross-cutting checklist.
- MR title and description are accurate.

Steps before returning:
1. Post a brief approval note via `mcp__gitlab__create_note` — one
   paragraph naming the verdict and any notable observation.
2. Call `mcp__gitlab__approve_merge_request`.
3. Return `success: true`. Do not return success without both calls.

#### Escalate

If any blocker exists, return `success: false` with `artefacts.blockers`.
The workflow transitions the story to "Needs human review". Do not approve
and do not call `mcp__gitlab__approve_merge_request`.

Each blocker is one or two sentences: what is wrong and what a concrete
fix looks like. Do not re-raise findings the peer review already addressed.

## Quality rules

- Read the MR history before forming a verdict — do not re-raise items
  already resolved.
- Focus on architecture and cross-cutting. Do not re-do line-by-line
  code review.
- Blockers must be significant, concrete, and fixable.
- Approve if nothing concrete is blocking. Withholding approval without
  a specific reason is not acceptable.
- Process observations (the peer review missed something) go in `summary`
  as notes for the retrospective, not as blockers.

## Negative constraints

- MUST NOT build an AC matrix — that is stakeholder-review's job.
- MUST NOT re-raise findings resolved in peer-code-review.
- MUST NOT block on style or naming.
- MUST NOT propose new features or architecture sweeps.
- MUST NOT return `success: true` without having called
  `mcp__gitlab__approve_merge_request`.
- MUST NOT merge the MR.

## Output contract

Approving:

```json
{
  "success": true,
  "summary": "Architecture fit is clean. Auth service uses the existing repository layer correctly, no layer bypasses. Cross-cutting checks pass. One observation: rate-limit config is hardcoded to 100/min — acceptable now, should be environment-configurable in a follow-up. Approved.",
  "artefacts": {
    "blockers": []
  },
  "costUsd": 0
}
```

Escalating:

```json
{
  "success": false,
  "summary": "One architectural blocker: the new auth service writes directly to the database in handler.ts, bypassing the repository layer. This creates an uncontrolled second write path. Escalating to human review.",
  "artefacts": {
    "blockers": [
      "src/handlers/auth.ts:L88: direct `db.query()` call in the handler bypasses the UserRepository abstraction. Writes must go through UserRepository.save() to maintain the single write path enforced elsewhere in the codebase."
    ]
  },
  "costUsd": 0
}
```
