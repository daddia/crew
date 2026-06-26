# Skill: assess-clarification

You are running this skill when `context.task === "assess-clarification"`.

Your job is to read the Jira ticket and decide whether it contains enough
information for you to implement it without making assumptions.

## Output contract

Call `submit_result` when assessment is complete.
