import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentResult } from "@daddia/crew";
import type { CliConfig, Finding, MrContext } from "../src/types.js";

vi.mock("../src/agents/code-quality/agent.js", () => ({
  codeQuality: { name: "code-quality", run: vi.fn() },
}));

import { runReview } from "../src/orchestrator.js";
import { codeQuality } from "../src/agents/code-quality/agent.js";

const mockRun = vi.mocked(codeQuality.run);

const baseMrCtx: MrContext = {
  projectId: "42",
  mrIid: "7",
  mrUrl: "https://gitlab.example.com/project/-/merge_requests/7",
  diff: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new",
  fileCount: 1,
  baseSha: "aaa",
  startSha: "bbb",
  headSha: "ccc",
  targetBranch: "main",
};

function makeResult(findings: Finding[], overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    summary: "Reviewed 1 file.",
    artefacts: { findings, filesReviewed: ["src/foo.ts"] },
    costUsd: 0.05,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: "high",
    file: "src/foo.ts",
    line: 10,
    title: "Missing error handling",
    body: "The function does not handle the error case.",
    confidence: "high",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    diffFileCap: 50,
    maxFindings: 10,
    severityThreshold: "high",
    ...overrides,
  };
}

describe("runReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns findings from the agent", async () => {
    const finding = makeFinding();
    mockRun.mockResolvedValue(makeResult([finding]));

    const result = await runReview(baseMrCtx, makeConfig());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(finding);
    expect(result.costUsd).toBe(0.05);
  });

  it("filters out findings below the severity threshold", async () => {
    const highFinding = makeFinding({ severity: "high" });
    const medFinding = makeFinding({ severity: "medium" });
    const lowFinding = makeFinding({ severity: "low" });

    mockRun.mockResolvedValue(makeResult([highFinding, medFinding, lowFinding]));

    const result = await runReview(baseMrCtx, makeConfig({ severityThreshold: "high" }));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe("high");
  });

  it("filters out low-confidence findings", async () => {
    const highConf = makeFinding({ confidence: "high" });
    const lowConf = makeFinding({ confidence: "low" });

    mockRun.mockResolvedValue(makeResult([highConf, lowConf]));

    const result = await runReview(baseMrCtx, makeConfig());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.confidence).toBe("high");
  });

  it("caps findings at maxFindings", async () => {
    const findings = Array.from({ length: 10 }, (_, i) =>
      makeFinding({ title: `Finding ${i}`, severity: "high" }),
    );
    mockRun.mockResolvedValue(makeResult(findings));

    const result = await runReview(baseMrCtx, makeConfig({ maxFindings: 3 }));

    expect(result.findings).toHaveLength(3);
  });

  it("sorts by severity before capping — most severe first", async () => {
    const critical = makeFinding({ severity: "critical", title: "Critical" });
    const medium = makeFinding({ severity: "medium", title: "Medium" });
    const high = makeFinding({ severity: "high", title: "High" });

    mockRun.mockResolvedValue(makeResult([medium, high, critical]));

    const result = await runReview(baseMrCtx, makeConfig({ maxFindings: 2, severityThreshold: "medium" }));

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]?.severity).toBe("critical");
    expect(result.findings[1]?.severity).toBe("high");
  });

  it("returns empty findings list when agent returns none", async () => {
    mockRun.mockResolvedValue(makeResult([]));

    const result = await runReview(baseMrCtx, makeConfig());

    expect(result.findings).toHaveLength(0);
    expect(result.summary).toBe("Reviewed 1 file.");
  });

  it("passes MR context into agent input", async () => {
    mockRun.mockResolvedValue(makeResult([]));

    await runReview(baseMrCtx, makeConfig());

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        issueKey: "42!7",
        context: expect.objectContaining({
          task: "review",
          mrIid: "7",
          mrUrl: baseMrCtx.mrUrl,
        }),
      }),
    );
  });
});
