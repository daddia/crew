import type { AgentInput } from "@daddia/crew";
import { codeQuality } from "./agents/code-quality/agent.js";
import { log } from "./observability.js";
import type { CliConfig, Finding, MrContext, ReviewResult, Severity } from "./types.js";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "note"];

function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(threshold);
}

export async function runReview(mrCtx: MrContext, config: CliConfig): Promise<ReviewResult> {
  const { maxFindings: MAX_FINDINGS, severityThreshold: SEVERITY_THRESHOLD } = config;
  const start = Date.now();

  const input: AgentInput = {
    issueKey: `${mrCtx.projectId}!${mrCtx.mrIid}`,
    context: {
      task: "review",
      mrIid: mrCtx.mrIid,
      mrUrl: mrCtx.mrUrl,
      diff: mrCtx.diff,
      targetBranch: mrCtx.targetBranch,
    },
  };

  log.info("orchestrator.run", { mrUrl: mrCtx.mrUrl });

  const result = await codeQuality.run(input);

  const allFindings = (result.artefacts["findings"] as Finding[] | undefined) ?? [];
  const filesReviewed = (result.artefacts["filesReviewed"] as string[] | undefined) ?? [];

  // Filter: must meet severity threshold and not be low confidence.
  const qualifying = allFindings.filter(
    (f) => meetsThreshold(f.severity, SEVERITY_THRESHOLD) && f.confidence !== "low",
  );

  // Sort most severe first, then cap.
  const sorted = qualifying.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  const findings = sorted.slice(0, MAX_FINDINGS);

  const filteredOut = allFindings.length - qualifying.length;
  const cappedOut = qualifying.length - findings.length;

  if (filteredOut > 0) {
    log.info("orchestrator.findings-filtered", {
      total: allFindings.length,
      filteredOut,
      threshold: SEVERITY_THRESHOLD,
    });
  }
  if (cappedOut > 0) {
    log.info("orchestrator.findings-capped", {
      qualifying: qualifying.length,
      posted: findings.length,
      cap: MAX_FINDINGS,
    });
  }

  if (result.success && filesReviewed.length === 0) {
    log.warn("orchestrator.no-files-reviewed", {
      mrUrl: mrCtx.mrUrl,
      hint: "agent did not populate artefacts.filesReviewed",
    });
  }

  return {
    findings,
    summary: result.summary,
    filesReviewed,
    costUsd: result.costUsd,
    durationMs: Date.now() - start,
  };
}
