import { log } from "./observability.js";
import type { Finding, MrContext, ReviewResult } from "./types.js";

const API_URL = process.env["GITLAB_API_URL"] ?? "https://gitlab.com/api/v4";
const TOKEN = process.env["GITLAB_TOKEN"] ?? "";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gitlabPost(path: string, body: unknown): Promise<void> {
  const delays = [1_000, 3_000];

  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    let networkErr: unknown;

    try {
      res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: {
          "PRIVATE-TOKEN": TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      networkErr = err;
    }

    if (res?.ok) return;

    const isRetryable = networkErr !== undefined || (res?.status ?? 0) >= 500;
    const delay = delays[attempt];

    if (!isRetryable || delay === undefined) {
      if (networkErr) {
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
        // statusCode 0 signals "no HTTP response received"; original error is preserved as `cause`.
        throw new GitLabPosterError(0, `POST ${path}: ${msg}`, { cause: networkErr });
      }
      const text = await res!.text().catch(() => "");
      throw new GitLabPosterError(res!.status, `POST ${path}: ${text}`);
    }

    log.warn("poster.retry", {
      path,
      status: res?.status,
      networkErr: networkErr instanceof Error ? networkErr.message : undefined,
      attempt: attempt + 1,
      delayMs: delay,
    });
    await sleep(delay);
  }
}

function severityBadge(severity: Finding["severity"]): string {
  const badges: Record<Finding["severity"], string> = {
    critical: "CRITICAL",
    high: "HIGH",
    medium: "MEDIUM",
    low: "LOW",
    note: "NOTE",
  };
  return badges[severity];
}

function formatFinding(finding: Finding): string {
  return [
    `**[AI Review] [${severityBadge(finding.severity)}] ${finding.title}**`,
    "",
    finding.body,
    "",
    `---`,
    `*AI-generated review. Confidence: ${finding.confidence}.*`,
  ].join("\n");
}

function formatSummary(mrCtx: MrContext, review: ReviewResult): string {
  const countBySeverity = (sev: Finding["severity"]): number =>
    review.findings.filter((f) => f.severity === sev).length;

  const severityCounts = (["critical", "high", "medium", "low", "note"] as const)
    .filter((sev) => countBySeverity(sev) > 0)
    .map((sev) => `${countBySeverity(sev)} ${sev}`)
    .join(", ");

  const durationSec = Math.round(review.durationMs / 1000);
  const costUsd = review.costUsd.toFixed(4);

  return [
    `## AI Code Review`,
    "",
    review.summary,
    "",
    `**Findings posted:** ${review.findings.length}${severityCounts ? ` (${severityCounts})` : ""}`,
    `**Files reviewed:** ${review.filesReviewed.length > 0 ? review.filesReviewed.join(", ") : mrCtx.fileCount + " files"}`,
    `**Duration:** ${durationSec}s | **Cost:** ~USD ${costUsd}`,
  ].join("\n");
}

async function postInlineThread(mrCtx: MrContext, finding: Finding): Promise<void> {
  const encoded = encodeURIComponent(mrCtx.projectId);
  const path = `/projects/${encoded}/merge_requests/${mrCtx.mrIid}/discussions`;

  try {
    await gitlabPost(path, {
      body: formatFinding(finding),
      position: {
        base_sha: mrCtx.baseSha,
        start_sha: mrCtx.startSha,
        head_sha: mrCtx.headSha,
        position_type: "text",
        new_path: finding.file,
        new_line: finding.line,
      },
    });
  } catch (err) {
    // The line may not appear in the diff (e.g. context-only or deleted file).
    // Fall back to a plain MR note so nothing is silently lost.
    log.warn("poster.inline-thread.fallback", {
      file: finding.file,
      line: finding.line,
      err: err instanceof Error ? err.message : String(err),
    });
    const notePath = `/projects/${encoded}/merge_requests/${mrCtx.mrIid}/notes`;
    await gitlabPost(notePath, { body: formatFinding(finding) });
  }
}

export async function postReview(mrCtx: MrContext, review: ReviewResult): Promise<void> {
  const encoded = encodeURIComponent(mrCtx.projectId);

  for (const finding of review.findings) {
    await postInlineThread(mrCtx, finding);
  }

  await gitlabPost(`/projects/${encoded}/merge_requests/${mrCtx.mrIid}/notes`, {
    body: formatSummary(mrCtx, review),
  });

  log.info("poster.done", {
    inlineThreads: review.findings.length,
    mrUrl: mrCtx.mrUrl,
  });
}

export async function postRefusal(mrCtx: MrContext, fileCount: number, cap: number): Promise<void> {
  const encoded = encodeURIComponent(mrCtx.projectId);

  await gitlabPost(`/projects/${encoded}/merge_requests/${mrCtx.mrIid}/notes`, {
    body: [
      `## AI Code Review`,
      "",
      `This MR changes ${fileCount} files, which exceeds the review limit of ${cap} files.`,
      `AI review was skipped. Split the MR or request a manual review.`,
    ].join("\n"),
  });
}

export class GitLabPosterError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.statusCode = statusCode;
    this.name = "GitLabPosterError";
  }
}
