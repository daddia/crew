#!/usr/bin/env node
import { loadMrContext } from "./context.js";
import { log } from "./observability.js";
import { runReview } from "./orchestrator.js";
import { postRefusal, postReview } from "./poster.js";
import type { CliConfig, Severity } from "./types.js";

const VALID_SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "note"];

export function loadConfig(): CliConfig {
  const rawCapEnv = process.env["DIFF_FILE_CAP"];
  const rawMaxEnv = process.env["MAX_FINDINGS"];
  const rawSevEnv = process.env["SEVERITY_THRESHOLD"];

  const rawCap = parseInt(rawCapEnv ?? "50", 10);
  const rawMax = parseInt(rawMaxEnv ?? "10", 10);
  const rawSev = (rawSevEnv ?? "high").toLowerCase();

  const capInvalid = Number.isNaN(rawCap) || rawCap <= 0;
  const maxInvalid = Number.isNaN(rawMax) || rawMax <= 0;
  const sevValid = VALID_SEVERITIES.includes(rawSev as Severity);

  if (capInvalid && rawCapEnv !== undefined) {
    log.warn("cli.config.invalid-diff-file-cap", { value: rawCapEnv, default: 50 });
  }
  if (maxInvalid && rawMaxEnv !== undefined) {
    log.warn("cli.config.invalid-max-findings", { value: rawMaxEnv, default: 10 });
  }
  if (!sevValid && rawSevEnv !== undefined) {
    log.warn("cli.config.invalid-severity", {
      value: rawSevEnv,
      default: "high",
      valid: VALID_SEVERITIES,
    });
  }

  return {
    diffFileCap: capInvalid ? 50 : rawCap,
    maxFindings: maxInvalid ? 10 : rawMax,
    severityThreshold: sevValid ? (rawSev as Severity) : "high",
  };
}

async function main(): Promise<void> {
  const mrIid = process.env["CI_MERGE_REQUEST_IID"];

  if (!mrIid) {
    log.info("cli.skip", { reason: "CI_MERGE_REQUEST_IID not set — not a merge request pipeline" });
    return;
  }

  const config = loadConfig();
  log.info("cli.start", { mrIid, config });

  const mrCtx = await loadMrContext();

  log.info("cli.context-loaded", { mrUrl: mrCtx.mrUrl, fileCount: mrCtx.fileCount });

  if (mrCtx.fileCount > config.diffFileCap) {
    log.warn("cli.diff-too-large", { fileCount: mrCtx.fileCount, cap: config.diffFileCap });
    await postRefusal(mrCtx, mrCtx.fileCount, config.diffFileCap);
    return;
  }

  const review = await runReview(mrCtx, config);

  log.info("cli.review-complete", {
    findings: review.findings.length,
    filesReviewed: review.filesReviewed.length,
    costUsd: review.costUsd,
    durationMs: review.durationMs,
  });

  await postReview(mrCtx, review);

  log.info("cli.done");
}

main().catch((err: unknown) => {
  // Exit 0 to preserve advisory posture — a crash in the reviewer must never
  // block a pipeline. The error and its stack are logged for observability,
  // since a 0 exit means CI logs are the only debugging surface.
  if (err instanceof Error) {
    log.error("cli.fatal", { err: err.message, stack: err.stack });
  } else {
    log.error("cli.fatal", { err: String(err) });
  }
  process.exit(0);
});
