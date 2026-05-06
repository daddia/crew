import { IterationCapReached, type AgentInput } from "@daddia/crew";
import { engineer } from "./agents/engineer/agent.js";
import { seniorEngineer } from "./agents/senior-engineer/agent.js";
import { createMr, getMrDiff } from "./integrations/gitlab.js";
import { commentOnIssue, transitionIssue } from "./integrations/jira.js";
import { seedEngineerMemory } from "./memory.js";
import { log } from "./observability.js";
import type { StateStore } from "./state.js";

const REFACTOR_LOOP_CAP = parseInt(process.env["REFACTOR_LOOP_CAP"] ?? "2", 10);

export interface WorkflowContext {
  issueKey: string;
  state: StateStore;
}

/**
 * Run the delivery build sequence for one story.
 *
 * Sequence:
 *   → engineer implements story on branch
 *   → engineer raises merge request
 *   → senior-engineer peer-code-review
 *   → bounded address-feedback loop (cap: REFACTOR_LOOP_CAP)
 *       → cap exceeded → emit `blocked` event, notify tech-lead → halt
 *   → status update: `in progress` → `in review`
 *   → emit `ready-for-review` event (handoff to delivery-review crew)
 *   → done
 *
 * On loop cap: transition to "Needs human review", comment with unresolved items, stop.
 *
 * Loop caps:
 *   REFACTOR_LOOP_CAP - max peer-review feedback/fix cycles before escalation
 */
export async function runStory(ctx: WorkflowContext): Promise<void> {
  const { issueKey, state } = ctx;
  const input: AgentInput = { issueKey, context: {} };

  log.info("workflow.start", { issueKey });

  await seedEngineerMemory(process.env["PROJECT_DIR"] ?? process.cwd());

  // ── Step 1: Implement ─────────────────────────────────────────────────────
  state.upsertStory(issueKey, "implement");
  state.startStep(issueKey, "implement");
  await transitionIssue(issueKey, "In Progress");

  const implResult = await engineer.run({
    ...input,
    context: { task: "implement-story" },
  });

  // Carry the engineer's session ID forward so the address-feedback loop
  // can resume the same session and preserve MR context across turns.
  let engineerSessionId = implResult.artefacts["sessionId"] as string | undefined;

  state.finishStep(issueKey, "implement", {
    costUsd: implResult.costUsd,
    verdict: implResult.success ? "ok" : "failed",
  });

  if (!implResult.success) {
    await escalateToHumanReview(issueKey, "Engineer failed to implement story", []);
    return;
  }

  // ── Step 2: Open MR ───────────────────────────────────────────────────────
  state.upsertStory(issueKey, "open-mr");
  state.startStep(issueKey, "open-mr");

  const mrUrl = await createMr({
    issueKey,
    branchName: implResult.artefacts["branchName"] as string,
    title: `[${issueKey}] ${implResult.artefacts["title"] as string ?? "Automated delivery"}`,
  });

  state.finishStep(issueKey, "open-mr", { verdict: mrUrl });

  // ── Step 3: Peer review + address-feedback loop ───────────────────────────
  let reviewPassed = false;
  let unresolvedItems: string[] = [];

  for (let iteration = 0; iteration < REFACTOR_LOOP_CAP + 1; iteration++) {
    // Peer review
    state.upsertStory(issueKey, "peer-code-review");
    state.startStep(issueKey, "peer-code-review");

    const diff = await getMrDiff(mrUrl);
    const reviewResult = await seniorEngineer.run({
      ...input,
      context: { task: "peer-code-review", mrUrl, diff },
    });

    state.finishStep(issueKey, "peer-code-review", {
      costUsd: reviewResult.costUsd,
      verdict: reviewResult.success ? "approved" : "changes-requested",
    });

    if (reviewResult.success) {
      reviewPassed = true;
      break;
    }

    unresolvedItems = (reviewResult.artefacts["comments"] as string[]) ?? [];

    // Address feedback — check cap before running
    if (iteration >= REFACTOR_LOOP_CAP) {
      break;
    }

    state.upsertStory(issueKey, "address-feedback");
    state.startStep(issueKey, "address-feedback");

    const feedbackResult = await engineer.run({
      ...input,
      context: {
        task: "address-feedback",
        mrUrl,
        comments: unresolvedItems,
        previousSessionId: engineerSessionId,
      },
    });

    engineerSessionId = feedbackResult.artefacts["sessionId"] as string | undefined;

    state.finishStep(issueKey, "address-feedback", {
      costUsd: feedbackResult.costUsd,
      verdict: feedbackResult.success ? "addressed" : "partial",
    });
  }

  if (!reviewPassed) {
    await escalateToHumanReview(issueKey, "Refactor loop cap reached", unresolvedItems);
    return;
  }

  // ── Done: hand off to delivery-review ─────────────────────────────────────
  state.upsertStory(issueKey, "in-review");
  await transitionIssue(issueKey, "In Review");

  log.info("workflow.ready-for-review", { issueKey, mrUrl });
}

/**
 * Resume the address-feedback step after a human posts an MR comment.
 * Called by the GitLab webhook handler.
 */
export async function addressFeedback(
  ctx: WorkflowContext,
  comment: string,
  mrUrl: string,
): Promise<void> {
  const { issueKey, state } = ctx;

  const iterationCount = state.countRefactorIterations(issueKey);
  if (iterationCount >= REFACTOR_LOOP_CAP) {
    log.warn("workflow.address-feedback.cap-exceeded", {
      issueKey,
      iterationCount,
    });
    await escalateToHumanReview(issueKey, "Refactor loop cap reached on human feedback", [comment]);
    return;
  }

  state.upsertStory(issueKey, "address-feedback");
  state.startStep(issueKey, "address-feedback");

  const result = await engineer.run({
    issueKey,
    context: { task: "address-feedback", mrUrl, comments: [comment] },
  });

  state.finishStep(issueKey, "address-feedback", {
    costUsd: result.costUsd,
    verdict: result.success ? "addressed" : "partial",
  });

  log.info("workflow.address-feedback.done", { issueKey, success: result.success });
}

async function escalateToHumanReview(
  issueKey: string,
  reason: string,
  unresolvedItems: string[],
): Promise<void> {
  log.warn("workflow.escalate", { issueKey, reason });
  const body =
    `*Escalated to human review.*\n\n` +
    `Reason: ${reason}\n\n` +
    (unresolvedItems.length > 0
      ? `Unresolved items:\n${unresolvedItems.map((i) => `- ${i}`).join("\n")}`
      : "");

  await commentOnIssue(issueKey, body);
  await transitionIssue(issueKey, "Needs human review");
}
