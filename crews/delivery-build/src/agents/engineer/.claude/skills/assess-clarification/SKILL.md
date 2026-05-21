# Skill: assess-clarification

You are running this skill when `context.task === "assess-clarification"`.

Your job is to read the Jira ticket and decide whether it contains enough
information for you to implement it without making assumptions. You do not
write any code in this skill.

## Inputs

| Field      | Source                 | Required                                           |
| ---------- | ---------------------- | -------------------------------------------------- |
| `issueKey` | top-level `AgentInput` | yes                                                |
| `ticket`   | `context.ticket`       | when available — pre-fetched summary + description |

## Steps

### 1. Read the ticket

If `context.ticket` is non-null, use it as your primary source. The object
has `summary` and `description` as plain-text strings. If `context.ticket`
is null (fetch failed upstream), call `mcp__atlassian__jira_get_issue` with
`issueKey` to retrieve it directly.

### 2. Evaluate completeness

The ticket is clear enough when all of the following hold:

- At least one concrete acceptance criterion (EARS or Gherkin) or an
  unambiguous functional requirement list is present.
- The scope is bounded — you can identify a finite set of files or
  interfaces that need to change.
- No hard blockers exist: missing data models, undefined external
  contracts, or irreconcilable conflicting requirements.

If any of these fail, compose questions. Ask all outstanding questions in
a single numbered list rather than one at a time.

### 3. Compose questions (if needed)

Each question must be:

- Specific: name the field, endpoint, scenario, or file in question.
- Actionable: answerable in one or two sentences.

Do not ask rhetorical or obvious questions. Do not repeat information
already present in the description.

### 4. Return immediately

Do not browse the codebase, create branches, or push files. Return as soon
as you have assessed the ticket.

## Output contract

When the ticket is clear:

```json
{
  "success": true,
  "summary": "Ticket is clear. No clarification needed.",
  "artefacts": { "questionsRequired": false },
  "costUsd": 0
}
```

When clarification is needed:

```json
{
  "success": true,
  "summary": "Two questions posted. Waiting for PM response.",
  "artefacts": {
    "questionsRequired": true,
    "questions": "1. What status should the ticket transition to...\n2. Is JIRA_ASSIGNEE_ACCOUNT_ID a numeric ID or email?"
  },
  "costUsd": 0
}
```

Rules:

- `questionsRequired` must be a boolean, never a string or undefined.
- `questions` is required and non-empty when `questionsRequired` is true.
- `success` is true in both cases — the assessment succeeded. Set
  `success: false` only if the ticket could not be read at all.
- Do not set `branchName` — this skill does not create a branch.
