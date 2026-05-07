import { unstable_v2_resumeSession } from "@anthropic-ai/claude-agent-sdk";
import { type AgentInput } from "@daddia/crew";
import { engineer } from "./agents/engineer/agent.js";
import { seniorEngineer } from "./agents/senior-engineer/agent.js";
import type { GitlabClient } from "./integrations/gitlab.js";
import type { JiraClient, JiraIssue } from "./integrations/jira.js";
import { seedEngineerMemory } from "./memory.js";
import { log } from "./observability.js";
import type { StateStore } from "./state.js";

export interface WorkflowContext {
  issueKey: string;
  state: StateStore;
  behaviour: {
    refactorLoopCap: number;
    anthropicModel?: string;
  };
  jira: JiraClient;
  gitlab: GitlabClient;
  projectDir: string;
}

/**
 * The parts of WorkflowContext that are shared across all stories — everything
 * except issueKey and state. Handlers and recovery use this to build a full
 * WorkflowContext at call time.
 */
export type WorkflowCtxBase = Omit<WorkflowContext, "issueKey" | "state">;

/**
 * Run the delivery build sequence for one story.
 *
 * Triggered by the ticket poller when a story enters `To Do` (assigned to
 * the engineer account), or when a clarification-pending story receives a
 * human response in Jira.
 *
 * Sequence:
 *   → engineer seeds context: reads Jira ticket + parent/epic (if present),
 *       design.md, and related artefacts
 *   → status update: `to do` → `in progress`
 *   → engineer assesses clarity; posts clarifying questions to Jira if required
 *       → ambiguous → status `blocked` (label: needs-clarification),
 *                     emit `blocked` event {reason: "clarification"}
 *       → orchestrator (poller) handles timeout: CLARIFICATION_TIMEOUT_HOURS
 *           → escalate to tech-lead + emit `blocked` event → halt
 *   → engineer implements story on branch
 *   → engineer runs local toolchain (lint, types, unit tests) — fail fast before review
 *   → senior-engineer reviews diff on branch: design fidelity, simplicity,
 *       correctness; posts feedback to GitLab MR or Jira comment
 *   → engineer bounded address-feedback loop (cap: REFACTOR_LOOP_CAP)
 *       → cap exceeded → status `blocked` (label: needs-tech-lead),
 *                        emit `blocked` event {reason: "refactor-cap"} → halt
 *   → engineer raises merge request (includes senior review notes in description)
 *   → status update: `in progress` → `ready for review`
 *   → emit `ready-for-review` event {issueKey, mrUrl}  // Slack notifier picks this up
 *   → done
 *
 * Out of scope for this crew (handled downstream):
 *   - CI failures on the open MR          → delivery-code-review
 *   - Human reviewer comments on the MR   → delivery-code-review
 *   - Final stakeholder merge decision     → delivery-final-review
 */
export async function runStory(ctx: WorkflowContext): Promise<void> {
  const { issueKey } = ctx;
  const input: AgentInput = { issueKey, context: {} };

  log.info("workflow.start", { issueKey });

  try {
    await runStoryInner(ctx, input);
  } catch (err) {
    log.error("workflow.unhandled-error", { issueKey, err: String(err) });
    await escalateToHumanReview(ctx.jira, issueKey, "Unexpected workflow error", []);
  }
}

async function runStoryInner(
  ctx: WorkflowContext,
  input: AgentInput,
): Promise<void> {
  const { issueKey, state, jira, gitlab, behaviour, projectDir } = ctx;

  await seedEngineerMemory(projectDir);

  // ── Step 1: Context seed ───────────────────────────────────────────────────
  // Fetch the Jira ticket (and its parent/epic, if present) before
  // implementation so agents have full story context. Fetch failures are
  // non-fatal: the workflow continues with ticket = null rather than
  // blocking the engineer entirely.
  state.upsertStory(issueKey, "context-seed");
  state.startStep(issueKey, "context-seed");

  let ticket: JiraIssue | null = null;
  let parentTicket: JiraIssue | null = null;

  try {
    ticket = await jira.getIssue(issueKey);
  } catch (err) {
    log.warn("workflow.context-seed.failed", { issueKey, err: String(err) });
  }

  if (ticket?.parentKey) {
    try {
      parentTicket = await jira.getIssue(ticket.parentKey);
    } catch (err) {
      log.warn("workflow.context-seed.parent-failed", {
        issueKey,
        parentKey: ticket.parentKey,
        err: String(err),
      });
    }
  }

  state.finishStep(issueKey, "context-seed", { verdict: ticket ? "ok" : "failed" });

  // ── Step 2: Transition to In Progress ─────────────────────────────────────
  await jira.transitionIssue(issueKey, "In Progress");

  // ── Step 3: Assess clarification ──────────────────────────────────────────
  // Ask the engineer whether the ticket is clear enough to implement.
  // If not, post questions, transition to Blocked, and park the story in
  // clarification-pending until a human responds. The poller resumes the
  // workflow from this point once an answer arrives.
  state.upsertStory(issueKey, "assess-clarification");

  const assessResult = await engineer.run({
    ...input,
    context: {
      task: "assess-clarification",
      ticket,
      parentTicket,
      model: behaviour.anthropicModel,
    },
  });

  const assessSessionId = assessResult.artefacts["sessionId"] as string | undefined;
  state.startStep(issueKey, "assess-clarification", assessSessionId);
  state.finishStep(issueKey, "assess-clarification", {
    costUsd: assessResult.costUsd,
    verdict: assessResult.success ? "ok" : "failed",
  });

  if (!assessResult.success) {
    await escalateToHumanReview(jira, issueKey, "Engineer failed to assess ticket clarity", []);
    return;
  }

  if (assessResult.artefacts["questionsRequired"] === true) {
    const questions =
      typeof assessResult.artefacts["questions"] === "string"
        ? assessResult.artefacts["questions"]
        : "The engineer requires clarification before proceeding.";

    await jira.commentOnIssue(issueKey, questions);
    await jira.transitionIssue(issueKey, "Blocked");

    state.upsertStory(issueKey, "clarification-pending");
    state.startStep(issueKey, "clarification-pending");
    state.finishStep(issueKey, "clarification-pending", { verdict: "pending" });

    log.info("workflow.blocked.clarification", { issueKey });
    return;
  }

  // ── Step 4: Implement ─────────────────────────────────────────────────────
  state.upsertStory(issueKey, "implement");

  const implResult = await engineer.run({
    ...input,
    context: {
      task: "implement-story",
      ticket,
      parentTicket,
      model: behaviour.anthropicModel,
    },
  });

  const branchNameRaw = implResult.artefacts["branchName"];
  const branchName: string | undefined =
    typeof branchNameRaw === "string" && branchNameRaw ? branchNameRaw : undefined;

  let engineerSessionId = implResult.artefacts["sessionId"] as string | undefined;
  state.startStep(issueKey, "implement", engineerSessionId);
  state.finishStep(issueKey, "implement", {
    costUsd: implResult.costUsd,
    verdict: implResult.success && branchName !== undefined ? "ok" : "failed",
  });

  if (!implResult.success) {
    await escalateToHumanReview(jira, issueKey, "Engineer failed to implement story", []);
    return;
  }

  if (!branchName) {
    await escalateToHumanReview(jira, issueKey, "Engineer did not produce a branch name", []);
    return;
  }

  // ── Step 5: Peer review + address-feedback loop (MR not yet opened) ───────
  // Senior engineer reviews the diff on the branch — design fidelity,
  // simplicity, correctness. They do not re-run the toolchain; deterministic
  // checks (lint, types, tests) are the engineer's responsibility and CI's.
  // Feedback is posted to GitLab or Jira by the senior engineer agent.
  let reviewPassed = false;
  let unresolvedItems: string[] = [];

  for (let iteration = 0; iteration < behaviour.refactorLoopCap + 1; iteration++) {
    state.upsertStory(issueKey, "peer-code-review");
    state.startStep(issueKey, "peer-code-review");

    const reviewResult = await seniorEngineer.run({
      ...input,
      context: { task: "peer-code-review", branchName, model: behaviour.anthropicModel },
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

    if (iteration >= behaviour.refactorLoopCap) {
      break;
    }

    state.upsertStory(issueKey, "address-feedback");

    const feedbackResult = await engineer.run({
      ...input,
      context: {
        task: "address-feedback",
        branchName,
        ticket,
        parentTicket,
        comments: unresolvedItems,
        previousSessionId: engineerSessionId,
        model: behaviour.anthropicModel,
      },
    });

    engineerSessionId = feedbackResult.artefacts["sessionId"] as string | undefined;
    state.startStep(issueKey, "address-feedback", engineerSessionId);
    state.finishStep(issueKey, "address-feedback", {
      costUsd: feedbackResult.costUsd,
      verdict: feedbackResult.success ? "addressed" : "partial",
    });
  }

  if (!reviewPassed) {
    await escalateToHumanReview(jira, issueKey, "Refactor loop cap reached", unresolvedItems);
    return;
  }

  // ── Step 6: Open MR (peer review approved) ────────────────────────────────
  state.upsertStory(issueKey, "open-mr");
  state.startStep(issueKey, "open-mr");

  const mrUrl = await gitlab.createMr({
    issueKey,
    branchName,
    title: `[${issueKey}] ${(implResult.artefacts["title"] as string) ?? "Automated delivery"}`,
  });

  state.finishStep(issueKey, "open-mr", { verdict: mrUrl });

  // ── Done: transition to Ready for Review and emit event ───────────────────
  state.upsertStory(issueKey, "ready-for-review");
  state.startStep(issueKey, "ready-for-review");
  await jira.transitionIssue(issueKey, "Ready for Review");
  state.finishStep(issueKey, "ready-for-review", { verdict: "ok" });

  log.info("workflow.ready-for-review", { issueKey, mrUrl });
}

async function escalateToHumanReview(
  jira: JiraClient,
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

  await jira.commentOnIssue(issueKey, body);
  await jira.transitionIssue(issueKey, "Needs human review");
}

const DEFAULT_RECOVERY_MODEL = "claude-opus-4-5";

/**
 * Scan for agent steps that started a session but never finished (process
 * crash mid-run). For each interrupted row, attempt to reconnect the SDK
 * session: if the session is still accessible, log info and restart the
 * story workflow; if the reconnect throws, log a warning and escalate.
 *
 * Called once on startup, before the HTTP server and poller are initialised,
 * so no new stories begin processing while recovery is in progress.
 */
export async function recoverInterruptedSteps(
  state: StateStore,
  ctxBase: WorkflowCtxBase,
): Promise<void> {
  const interrupted = state.getInterruptedSteps();

  for (const row of interrupted) {
    const { issueKey, step, sessionId } = row;

    try {
      // Probe whether the SDK session is still accessible. The returned handle
      // is intentionally discarded: the workflow restarts from context-seed
      // rather than resuming mid-step, because the step's intermediate state
      // is not persisted.
      unstable_v2_resumeSession(sessionId!, {
        model: ctxBase.behaviour.anthropicModel ?? DEFAULT_RECOVERY_MODEL,
      });
      log.info("recovery.session-resumed", { issueKey, step, sessionId });
      await runStory({ issueKey, state, ...ctxBase });
    } catch (err) {
      log.warn("recovery.session-failed", { issueKey, step, sessionId, err: String(err) });
      try {
        await escalateToHumanReview(ctxBase.jira, issueKey, "Crash recovery failed: " + String(err), []);
      } catch (escalateErr) {
        // Escalation can fail when the Jira API is unreachable. Log and
        // continue so the remaining interrupted rows are still attempted.
        log.error("recovery.escalation-failed", { issueKey, err: String(escalateErr) });
      }
    }
  }
}
