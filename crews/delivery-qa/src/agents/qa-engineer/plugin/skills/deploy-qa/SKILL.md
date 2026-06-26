# Skill: deploy-qa

You are running this skill when `context.task === "deploy-qa"`.

## Inputs

| Field            | Source    | Required |
| ---------------- | --------- | -------- |
| `issueKey`       | AgentInput | yes     |
| `qaWorkspaceDir` | context   | yes      |
| `branchName`     | context   | yes      |
| `mrUrl`          | context   | yes      |

## Steps

1. Confirm `branchName` exists via `mcp__gitlab__list_branches` or local `git`
   in the QA workspace.
2. In `qaWorkspaceDir`, checkout the MR branch:
   - `git fetch origin`
   - `git checkout <branchName>` (create tracking branch if needed)
3. Install dependencies per project conventions (`pnpm install`, `npm ci`, etc.).
   Read `package.json` or project docs first.
4. If `QA_DEPLOY_SCRIPT` is configured, run it from the workspace root via
   **Bash**. Treat non-zero exit as an infrastructure failure.
5. Verify the workspace is ready for test execution (build artefacts, env files
   documented in README).

If checkout or install fails, return `success: false` with an infrastructure
summary. Do not claim deploy succeeded.

## Output

Call `submit_result` with:

```json
{
  "success": true,
  "summary": "Checked out feature/CREW-42-foo and installed dependencies.",
  "artefacts": {
    "verdict": "pass"
  }
}
```

On failure:

```json
{
  "success": false,
  "summary": "Checkout failed: branch not found on origin.",
  "artefacts": {
    "verdict": "fail"
  }
}
```

## Constraints

- MUST NOT push commits or open merge requests.
- MUST NOT merge or approve MRs.
- MUST NOT modify application source — only checkout and install steps.
