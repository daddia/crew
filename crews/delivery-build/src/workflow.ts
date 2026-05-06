import { type AgentInput } from "@daddia/crew";
import { engineer } from "./agents/engineer/agent.js";
import { seniorEngineer } from "./agents/senior-engineer/agent.js";
import { createMr, getPipelineStatus } from "./integrations/gitlab.js";
import { commentOnIssue, getIssue, transitionIssue, type JiraIssue } from "./integrations/jira.js";
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
 *   → context-seed: fetch Jira ticket (non-fatal if it fails)
 *   → engineer implements story on branch
 *   → senior-engineer peer-code-review
 *   → bounded address-feedback loop (cap: REFACTOR_LOOP_CAP)
 *       → cap exceeded → escalate to human review → halt (MR NOT opened)
 *   → engineer raises merge request (only after peer review approves)
 *   → CI monitoring loop: poll pipeline, fix on failure (cap: CI_RETRY_CAP)
 *       → cap exceeded → escalate to human review → halt
 *   → status update: `in progress` → `in review`
 *   → log handoff; delivery-review crew polls for "In Review" tickets (event bus is a TODO)
 *   → done
 *
 * On loop cap: transition to "Needs human review", comment with unresolved items, stop.
 *
 * Loop caps:
 *   REFACTOR_LOOP_CAP - max peer-review feedback/fix cycles before escalation
 *   CI_RETRY_CAP      - max CI fix attempts before escalation
 */
export async function runStory(ctx: WorkflowContext): Promise<void> {
  const { issueKey, state } = ctx;
  const input: AgentInput = { issueKey, context: {} };

  log.info("workflow.start", { issueKey });

  try {
    await runStoryInner(ctx, input);
  } catch (err) {
    log.error("workflow.unhandled-error", { issueKey, err: String(err) });
    await escalateToHumanReview(issueKey, "Unexpected workflow error", []);
  }
}

async function runStoryInner(
  ctx: WorkflowContext,
  input: AgentInput,
): Promise<void> {
  const { issueKey, state } = ctx;

  await seedEngineerMemory(process.env["PROJECT_DIR"] ?? process.cwd());

  // ── Step 1: Context seed ───────────────────────────────────────────────────
  // Fetch the Jira ticket before implementation so agents have full story
  // context. A fetch failure is non-fatal: the workflow continues with
  // ticket = null rather than blocking the engineer entirely.
  state.upsertStory(issueKey, "context-seed");
  state.startStep(issueKey, "context-seed");

  let ticket: JiraIssue | null = null;
  try {
    ticket = await getIssue(issueKey);
  } catch (err) {
    log.warn("workflow.context-seed.failed", { issueKey, err: String(err) });
  }

  state.finishStep(issueKey, "context-seed", { verdict: ticket ? "ok" : "failed" });

  // ── Step 2: Implement ─────────────────────────────────────────────────────
  state.upsertStory(issueKey, "implement");
  state.startStep(issueKey, "implement");
  await transitionIssue(issueKey, "In Progress");

  const implResult = await engineer.run({
    ...input,
    context: { task: "implement-story", ticket },
  });

  // Carry the engineer's session ID forward so the address-feedback loop
  // can resume the same session and preserve branch context across turns.
  let engineerSessionId = implResult.artefacts["sessionId"] as string | undefined;

  state.finishStep(issueKey, "implement", {
    costUsd: implResult.costUsd,
    verdict: implResult.success ? "ok" : "failed",
  });

  if (!implResult.success) {
    await escalateToHumanReview(issueKey, "Engineer failed to implement story", []);
    return;
  }

  const branchName = implResult.artefacts["branchName"];
  if (typeof branchName !== "string" || !branchName) {
    await escalateToHumanReview(issueKey, "Engineer did not produce a branch name", []);
    return;
  }

  // ── Step 2: Peer review + address-feedback loop (MR not yet opened) ───────
  let reviewPassed = false;
  let unresolvedItems: string[] = [];

  for (let iteration = 0; iteration < REFACTOR_LOOP_CAP + 1; iteration++) {
    // Peer review
    state.upsertStory(issueKey, "peer-code-review");
    state.startStep(issueKey, "peer-code-review");

    const reviewResult = await seniorEngineer.run({
      ...input,
      context: { task: "peer-code-review", branchName },
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
        branchName,
        ticket,
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

  // ── Step 3: Open MR (peer review approved) ────────────────────────────────
  state.upsertStory(issueKey, "open-mr");
  state.startStep(issueKey, "open-mr");

  const mrUrl = await createMr({
    issueKey,
    branchName,
    title: `[${issueKey}] ${implResult.artefacts["title"] as string ?? "Automated delivery"}`,
  });

  state.finishStep(issueKey, "open-mr", { verdict: mrUrl });

  // ── Step 4: CI monitoring loop ────────────────────────────────────────────
  // Read caps inside the function so tests can override via process.env.
  const ciRetryCap = parseInt(process.env["CI_RETRY_CAP"] ?? "3", 10);
  const ciPollInterval = parseInt(process.env["CI_POLL_INTERVAL_MS"] ?? "30000", 10);
  let ciFixAttempts = 0;

  while (true) {
    state.upsertStory(issueKey, "ci-check");
    state.startStep(issueKey, "ci-check");

    const pipelineStatus = await getPipelineStatus(mrUrl);

    state.finishStep(issueKey, "ci-check", { verdict: pipelineStatus });

    if (pipelineStatus === "success") {
      break;
    }

    if (pipelineStatus === "failed") {
      if (ciFixAttempts >= ciRetryCap) {
        await escalateToHumanReview(issueKey, "CI fix cap reached", []);
        return;
      }

      state.upsertStory(issueKey, "ci-fix");
      state.startStep(issueKey, "ci-fix");

      const ciFixResult = await engineer.run({
        ...input,
        context: { task: "fix-ci", mrUrl, ticket, ciFailure: pipelineStatus },
      });

      state.finishStep(issueKey, "ci-fix", {
        costUsd: ciFixResult.costUsd,
        verdict: ciFixResult.success ? "fixed" : "partial",
      });

      ciFixAttempts++;
    } else {
      // created, pending, running, canceled — transient; wait before re-polling
      await sleep(ciPollInterval);
    }
  }

  // ── Done: transition to "In Review" — delivery-review crew picks up from here
  state.upsertStory(issueKey, "in-review");
  await transitionIssue(issueKey, "In Review");

  // Delivery-review polls for "In Review" tickets as its trigger. A dedicated
  // event bus integration is tracked separately.
  log.info("workflow.handoff", { issueKey, mrUrl });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  try {
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

    // Session continuity: previousSessionId is not threaded through here
    // because the state store does not yet persist session IDs. Until
    // StateStore.getLastSessionId() exists, the engineer always starts a fresh
    // session for human-posted feedback. The inline peer-review loop (runStory)
    // carries session IDs in memory, so it is unaffected.
    const result = await engineer.run({
      issueKey,
      context: { task: "address-feedback", mrUrl, comments: [comment] },
    });

    state.finishStep(issueKey, "address-feedback", {
      costUsd: result.costUsd,
      verdict: result.success ? "addressed" : "partial",
    });

    log.info("workflow.address-feedback.done", { issueKey, success: result.success });
  } catch (err) {
    log.error("workflow.address-feedback.unhandled-error", { issueKey, err: String(err) });
    await escalateToHumanReview(issueKey, "Unexpected error addressing feedback", []);
  }
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
