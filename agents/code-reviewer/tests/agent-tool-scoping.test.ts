import { describe, expect, it } from "vitest";

// Import the ALLOWED_TOOLS list indirectly by importing the agent module.
// The agent throws when run() is called (SDK not wired), but the module-level
// constant is accessible via the named export for assertion.
import { codeQuality } from "../src/agents/code-quality/agent.js";

// Verbs that indicate a write or destructive operation.
// Checked against the action segment of the tool name (the part after the last `__`).
const WRITE_VERBS = ["create", "update", "delete", "push", "merge", "approve", "edit"];

// Tool names that are write operations regardless of naming convention.
const WRITE_TOOL_EXACT = new Set(["Bash", "Write", "Edit", "MultiEdit"]);

describe("code-quality agent tool scoping", () => {
  it("exports a named agent with the correct name", () => {
    expect(codeQuality.name).toBe("code-quality");
  });

  it("run is a function", () => {
    expect(typeof codeQuality.run).toBe("function");
  });

  it("run throws before SDK is wired (not silently no-ops)", async () => {
    await expect(
      codeQuality.run({ issueKey: "test!1", context: {} }),
    ).rejects.toThrow("Claude SDK integration not yet wired");
  });
});

describe("ALLOWED_TOOLS whitelist", () => {
  // Parse the agent source to extract the ALLOWED_TOOLS array.
  // This is a belt-and-suspenders check: if someone adds a write tool, this test fails.
  it("contains only read-only GitLab tools", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const source = await readFile(
      join(__dirname, "../src/agents/code-quality/agent.ts"),
      "utf-8",
    );

    const match = source.match(/const ALLOWED_TOOLS\s*=\s*\[([^\]]+)\]/s);
    expect(match, "ALLOWED_TOOLS array not found in agent source").toBeTruthy();

    const toolsBlock = match![1]!;
    const tools = toolsBlock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith('"'))
      .map((line) => line.replace(/[",]/g, "").trim());

    for (const tool of tools) {
      if (WRITE_TOOL_EXACT.has(tool)) {
        expect.fail(`Write tool found in ALLOWED_TOOLS: ${tool}`);
      }
      // For MCP tools like `mcp__gitlab__create_note`, check the action segment only.
      const action = tool.includes("__") ? (tool.split("__").pop() ?? "") : tool;
      const isWriteVerb = WRITE_VERBS.some((verb) => action.startsWith(verb));
      expect(isWriteVerb, `Write tool found in ALLOWED_TOOLS: ${tool}`).toBe(false);
    }
  });
});
