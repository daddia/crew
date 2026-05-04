import type { AgentInput } from "@daddia/contracts";
import { IterationCapReached } from "@daddia/sdk";
import { engineer } from "./agents/engineer/agent.js";
import { seniorEngineer } from "./agents/senior-engineer/agent.js";
import { techLead } from "./agents/tech-lead/agent.js";
import { createMr, getMrDiff } from "./integrations/gitlab.js";
import { commentOnIssue, transitionIssue } from "./integrations/jira.js";
import { seedProjectMemory } from "./memory.js";
import { log } from "./observability.js";
import type { StateStore } from "./state.js";

const REFACTOR_LOOP_CAP = parseInt(process.env["REFACTOR_LOOP_CAP"] ?? "2", 10);

export interface WorkflowContext {
  issueKey: string;
  state: StateStore;
}

/**
 * Run the full Track 4 delivery sequence for one story.
 *
 * Sequence:
 *   triage (skipped in MVP — story arrives already triaged)
 *   → engineer implements + opens MR
 *   → senior-engineer peer-code-review
 *   → bounded address-feedback loop (cap: REFACTOR_LOOP_CAP)
 *   → tech-lead final-code-review  (architecture + cross-cutting gate; approves MR)
 *   → tech-lead stakeholder-review (acceptance-criteria validation)
 *   → done
 *
 * On loop cap: transition to "Needs human review", comment with unresolved items, stop.
 */
export async function runStory(ctx: WorkflowContext): Promise<void> {
  const { issueKey, state } = ctx;
  const input: AgentInput = { issueKey, context: {} };

  log.info("workflow.start", { issueKey });

  await seedProjectMemory(process.env["PROJECT_DIR"] ?? process.cwd());

  // ── Phase 1: Implement ────────────────────────────────────────────────────
  state.upsertStory(issueKey, "implement");
  state.startPhase(issueKey, "implement");
  await transitionIssue(issueKey, "In Progress");

  const implResult = await engineer.run({
    ...input,
    context: { task: "implement-story" },
  });

  state.finishPhase(issueKey, "implement", {
    costUsd: implResult.costUsd,
    verdict: implResult.success ? "ok" : "failed",
  });

  if (!implResult.success) {
    await escalateToHumanReview(issueKey, "Engineer failed to implement story", []);
    return;
  }

  // ── Phase 2: Open MR ──────────────────────────────────────────────────────
  state.upsertStory(issueKey, "open-mr");
  state.startPhase(issueKey, "open-mr");

  const mrUrl = await createMr({
    issueKey,
    branchName: implResult.artefacts["branchName"] as string,
    title: `[${issueKey}] ${implResult.artefacts["title"] as string ?? "Automated delivery"}`,
  });

  state.finishPhase(issueKey, "open-mr", { verdict: mrUrl });

  // ── Phase 3: Peer review + address-feedback loop ──────────────────────────
  let reviewPassed = false;
  let unresolvedItems: string[] = [];

  for (let iteration = 0; iteration < REFACTOR_LOOP_CAP + 1; iteration++) {
    // Peer review
    state.upsertStory(issueKey, "peer-code-review");
    state.startPhase(issueKey, "peer-code-review");

    const diff = await getMrDiff(mrUrl);
    const reviewResult = await seniorEngineer.run({
      ...input,
      context: { task: "peer-code-review", mrUrl, diff },
    });

    state.finishPhase(issueKey, "peer-code-review", {
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
    state.startPhase(issueKey, "address-feedback");

    const feedbackResult = await engineer.run({
      ...input,
      context: { task: "address-feedback", mrUrl, comments: unresolvedItems },
    });

    state.finishPhase(issueKey, "address-feedback", {
      costUsd: feedbackResult.costUsd,
      verdict: feedbackResult.success ? "addressed" : "partial",
    });
  }

  if (!reviewPassed) {
    await escalateToHumanReview(issueKey, "Refactor loop cap reached", unresolvedItems);
    return;
  }

  // ── Phase 4: Final code review ────────────────────────────────────────────
  state.upsertStory(issueKey, "final-code-review");
  state.startPhase(issueKey, "final-code-review");

  const finalCodeResult = await techLead.run({
    ...input,
    context: { task: "final-code-review", mrUrl },
  });

  state.finishPhase(issueKey, "final-code-review", {
    costUsd: finalCodeResult.costUsd,
    verdict: finalCodeResult.success ? "approved" : "rejected",
  });

  if (!finalCodeResult.success) {
    await escalateToHumanReview(
      issueKey,
      "Tech lead rejected final code review",
      (finalCodeResult.artefacts["blockers"] as string[]) ?? [],
    );
    return;
  }

  // ── Phase 5: Stakeholder review ───────────────────────────────────────────
  state.upsertStory(issueKey, "stakeholder-review");
  state.startPhase(issueKey, "stakeholder-review");

  const stakeholderResult = await techLead.run({
    ...input,
    context: { task: "stakeholder-review", mrUrl },
  });

  state.finishPhase(issueKey, "stakeholder-review", {
    costUsd: stakeholderResult.costUsd,
    verdict: stakeholderResult.success ? "complete" : "incomplete",
  });

  if (!stakeholderResult.success) {
    await escalateToHumanReview(
      issueKey,
      "Stakeholder review: acceptance criteria not met",
      (stakeholderResult.artefacts["gaps"] as string[]) ?? [],
    );
    return;
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  state.upsertStory(issueKey, "done");
  await transitionIssue(issueKey, "Done");

  log.info("workflow.done", { issueKey, mrUrl });
}

/**
 * Resume the address-feedback phase after a human posts an MR comment.
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
  state.startPhase(issueKey, "address-feedback");

  const result = await engineer.run({
    issueKey,
    context: { task: "address-feedback", mrUrl, comments: [comment] },
  });

  state.finishPhase(issueKey, "address-feedback", {
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
