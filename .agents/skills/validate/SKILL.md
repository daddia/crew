---
name: validate
description: |
  Performs a final stakeholder validation that an epic is complete against its backlog.md acceptance criteria. Use when the user mentions "validate {epic}", "final review of {epic}", "check {epic} is complete", or "acceptance review". Confirms every story's EARS and Gherkin criteria hold and the phase exit criteria in roadmap.md are met. Do NOT use for code review — use review-code. Do NOT use to review design docs before implementation — use review-docs.
allowed-tools:
  - Read
  - Write
  - StrReplace
  - Glob
  - Grep
  - Shell
  - SemanticSearch
  - Task
argument-hint: <epic-id>
---

# Validate Epic Completion

You are a QA Lead performing a final stakeholder review to confirm an epic is
production-ready and every acceptance criterion is satisfied.

## Negative constraints

A validation report MUST NOT:

- Write new acceptance criteria — it verifies criteria already in backlog.md
- Include implementation detail → solution.md or work/{wp}/design.md
- Reopen decisions that were closed during the sprint → raise a follow-up story instead
- Include business rationale → product.md

## Context

<artifacts>
[Provided by the caller: epic ID, backlog, requirements document, design
document, and access to the application codebase]
</artifacts>

## Inputs

You need the following for the target epic:

| Input                 | Location                         | Required    |
| --------------------- | -------------------------------- | ----------- |
| Backlog               | `product/backlog.md`             | Yes         |
| Requirements          | `work/{EPIC_ID}/requirements.md` | If exists   |
| Design                | `work/{EPIC_ID}/design.md`       | If exists   |
| Application code      | `{repo}:src/`                    | Yes         |
| Solution architecture | `architecture/solution.md`       | If relevant |
| ADRs                  | `architecture/decisions/`        | If relevant |

## Steps

### Phase 1: Gather context

1. Read `product/backlog.md` and locate the target epic and all its stories
2. Read the requirements document for the epic if one exists
3. Read the design document for the epic if one exists
4. Read the solution architecture if the epic touches architectural boundaries
5. Read any relevant ADRs referenced by the design or requirements

### Phase 2: Build the acceptance matrix

For every story in the epic, build a table of acceptance criteria with columns:

| Story    | Criterion                    | Evidence                             | Status                |
| -------- | ---------------------------- | ------------------------------------ | --------------------- |
| CF-XX-YY | Description of the criterion | File path, test name, or observation | pass / fail / partial |

- **pass**: Criterion fully satisfied with evidence in the codebase
- **fail**: Criterion not met -- no evidence found, or implementation contradicts it
- **partial**: Some aspects met but gaps remain -- describe what is missing

### Phase 3: Validate against code

For each acceptance criterion:

1. Search the application codebase (`{repo}:src/`) for the implementation
2. Read the relevant source files and confirm the behaviour described by the criterion
3. Check for unit or integration tests that cover the criterion
4. If the criterion references configuration, environment variables, or infrastructure, confirm they are present and documented
5. Record the evidence (file path + line range, test name, or concrete observation)

Be thorough. Do not assume a criterion is met because a file exists -- read the
code and confirm the logic matches the requirement.

### Phase 4: Validate against design

If a design document exists:

1. Confirm the implementation matches the specified architecture (components, data flow, interfaces)
2. Confirm API contracts match the design (method signatures, schemas, error codes)
3. Confirm data models match the design
4. Confirm performance and security controls are implemented as specified
5. Note any deviations -- they are not necessarily failures, but must be documented

### Phase 5: Cross-cutting checks

| Check          | What to verify                                                              |
| -------------- | --------------------------------------------------------------------------- |
| Tests          | Unit and integration tests exist and cover each public interface            |
| Types          | No `any` casts that bypass type safety on public boundaries                 |
| Error handling | Errors handled as specified in design; no silent swallows                   |
| Documentation  | README, runbooks, or inline docs updated if required by acceptance criteria |
| Environment    | New environment variables added to `.env.example`                           |
| Dependencies   | No unused or undeclared dependencies                                        |

### Phase 6: Update the backlog

Based on the acceptance matrix, update `product/backlog.md`:

1. **Completed criteria**: Check the box `- [x]`
2. **Incomplete or partial criteria**: Uncheck the box `- [ ]` and append a
   brief note explaining what remains (e.g. `-- not wired to scheduler`)
3. **Story status**: Update the story status in the epic summary table:
   - All criteria pass -> `done`
   - Some criteria fail or partial -> `in-progress`
   - No criteria pass -> `backlog`
4. **New backlog items**: If validation reveals work not covered by existing
   stories (bugs, missing integration, undocumented gaps), add new stories to
   the epic following the existing ID and format conventions
5. **Epic status**: Summarise the overall epic status at the top of the epic
   section if all stories are done

### Phase 7: Produce the validation report

## Quality rules

- Every acceptance criterion must be evaluated -- none may be skipped
- Evidence must be specific: cite file paths, function names, test names
- Do not mark a criterion as pass without reading the implementing code
- Do not mark a criterion as fail without searching thoroughly (check multiple
  file patterns, grep for key terms, review related modules)
- Deviations from the design are findings, not automatic failures -- document
  the deviation and whether it is acceptable
- Backlog updates must preserve the existing format and conventions exactly

## Output format

After completing validation, produce a report structured as follows.

<example>

## Validation Report -- CF-XX: Epic Title

**Date:** YYYY-MM-DD
**Validator:** AI QA Review
**Epic status:** complete | incomplete

### Summary

{1-2 sentence summary: how many stories, how many criteria, overall result}

### Acceptance Matrix

| Story    | Criterion   | Evidence                                        | Status  |
| -------- | ----------- | ----------------------------------------------- | ------- |
| CF-XX-01 | Description | `path/to/file.ts` L12-45                        | pass    |
| CF-XX-01 | Description | `path/to/test.ts::test name`                    | pass    |
| CF-XX-02 | Description | Not found in codebase                           | fail    |
| CF-XX-03 | Description | Partially implemented in `file.ts` -- missing X | partial |

### Design Deviations

| Area       | Design spec     | Actual implementation | Assessment                                  |
| ---------- | --------------- | --------------------- | ------------------------------------------- |
| API method | `POST /api/foo` | `PUT /api/foo`        | Acceptable -- aligned with REST conventions |

(Omit this section if no deviations found.)

### Findings

- **[fail]** CF-XX-02 criterion Y: {description of what is missing}
- **[partial]** CF-XX-03 criterion Z: {description of what remains}
- **[observation]** {any other notable finding}

(Omit this section if all criteria pass.)

### Backlog Changes

- CF-XX-01: status updated to `done`, all criteria checked
- CF-XX-02: criterion Y unchecked, note added
- CF-XX-04 (new): {title of new story added to address gap}

### Conclusion

{Final assessment: is the epic ready for stakeholder sign-off? If not, what
must be resolved first?}

</example>
