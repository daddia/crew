export type Severity = "critical" | "high" | "medium" | "low" | "note";
export type Confidence = "high" | "medium" | "low";

export interface CliConfig {
  diffFileCap: number;
  maxFindings: number;
  severityThreshold: Severity;
}

export interface Finding {
  severity: Severity;
  file: string;
  line: number;
  title: string;
  body: string;
  confidence: Confidence;
}

export interface ReviewResult {
  findings: Finding[];
  summary: string;
  filesReviewed: string[];
  costUsd: number;
  durationMs: number;
}

export interface MrContext {
  projectId: string;
  mrIid: string;
  mrUrl: string;
  diff: string;
  fileCount: number;
  baseSha: string;
  startSha: string;
  headSha: string;
  targetBranch: string;
}
