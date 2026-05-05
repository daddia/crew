import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { seedProjectMemory } from "../src/memory.js";

const mockAccess = vi.mocked(access);
const mockMkdir = vi.mocked(mkdir);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

const ENOENT = Object.assign(new Error("ENOENT: no such file"), {
  code: "ENOENT",
});
const EACCES = Object.assign(new Error("EACCES: permission denied"), {
  code: "EACCES",
});

describe("seedProjectMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: package.json and AGENTS.md are readable.
    mockReadFile.mockResolvedValue("# AGENTS content" as never);
  });

  describe("when MEMORY.md does not yet exist", () => {
    beforeEach(() => {
      // access() throws → file does not exist
      mockAccess.mockRejectedValue(ENOENT);
    });

    it("writes MEMORY.md to the project memory directory", async () => {
      await seedProjectMemory("/project");

      expect(mockWriteFile).toHaveBeenCalledOnce();
      const [writtenPath] = mockWriteFile.mock.calls[0] as [string, ...unknown[]];
      expect(writtenPath).toContain(".claude/agent-memory/engineer/MEMORY.md");
    });

    it("creates the directory before writing", async () => {
      await seedProjectMemory("/project");

      expect(mockMkdir).toHaveBeenCalledOnce();
      const [mkdirPath, opts] = mockMkdir.mock.calls[0] as [string, unknown];
      expect(mkdirPath).toContain(".claude/agent-memory/engineer");
      expect(opts).toMatchObject({ recursive: true });
    });

    it("includes language/tooling from package.json when present", async () => {
      mockReadFile.mockImplementation(async (path) => {
        if (String(path).endsWith("package.json")) {
          return JSON.stringify({
            packageManager: "pnpm@10.0.0",
            devDependencies: { vitest: "^4.0.0", turbo: "^2.0.0" },
          }) as never;
        }
        return "# AGENTS" as never;
      });

      await seedProjectMemory("/project");

      const written = mockWriteFile.mock.calls[0]?.[1] as string;
      expect(written).toContain("pnpm");
      expect(written).toContain("Vitest");
      expect(written).toContain("Turborepo");
    });

    it("includes AGENTS.md content when present", async () => {
      mockReadFile.mockImplementation(async (path) => {
        if (String(path).endsWith("AGENTS.md")) {
          return "# AGENTS\n\nConventions here." as never;
        }
        throw ENOENT;
      });

      await seedProjectMemory("/project");

      const written = mockWriteFile.mock.calls[0]?.[1] as string;
      expect(written).toContain("Conventions here.");
    });

    it("still writes when package.json is missing", async () => {
      mockReadFile.mockRejectedValue(ENOENT);

      await seedProjectMemory("/project");

      expect(mockWriteFile).toHaveBeenCalledOnce();
    });
  });

  describe("when MEMORY.md already exists", () => {
    beforeEach(() => {
      // access() succeeds → file exists
      mockAccess.mockResolvedValue(undefined as never);
    });

    it("does not write a new MEMORY.md", async () => {
      await seedProjectMemory("/project");

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("does not create the directory", async () => {
      await seedProjectMemory("/project");

      expect(mockMkdir).not.toHaveBeenCalled();
    });
  });

  describe("when the write fails", () => {
    beforeEach(() => {
      mockAccess.mockRejectedValue(ENOENT);
      mockMkdir.mockRejectedValue(EACCES);
    });

    it("logs a warn-level message", async () => {
      const warnSpy = vi.spyOn(process.stdout, "write").mockImplementation(
        () => true,
      );

      await seedProjectMemory("/project");

      const logged = warnSpy.mock.calls
        .map((c) => String(c[0]))
        .find((s) => s.includes("warn") && s.includes("memory.seed-failed"));

      expect(logged).toBeTruthy();
      warnSpy.mockRestore();
    });

    it("does not throw — workflow continues normally", async () => {
      await expect(seedProjectMemory("/project")).resolves.toBeUndefined();
    });
  });
});
