import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("@daddia/crew", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@daddia/crew")>();
  return {
    ...actual,
    seedProjectMemory: vi.fn().mockResolvedValue(null),
  };
});

import { access, readFile } from "node:fs/promises";
import { seedProjectMemory } from "@daddia/crew";
import { seedEngineerMemory } from "../src/memory.js";

const mockAccess = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);
const mockSeedProjectMemory = vi.mocked(seedProjectMemory);

const ENOENT = Object.assign(new Error("ENOENT: no such file"), {
  code: "ENOENT",
});
const EACCES = Object.assign(new Error("EACCES: permission denied"), {
  code: "EACCES",
});

describe("seedEngineerMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(ENOENT);
    mockAccess.mockRejectedValue(ENOENT);
    mockSeedProjectMemory.mockResolvedValue(null);
  });

  it("calls seedProjectMemory with projectDir and persona 'engineer'", async () => {
    await seedEngineerMemory("/project");

    expect(mockSeedProjectMemory).toHaveBeenCalledOnce();
    const [calledDir, calledPersona] = mockSeedProjectMemory.mock.calls[0] as [string, string, string];
    expect(calledDir).toBe("/project");
    expect(calledPersona).toBe("engineer");
  });

  it("includes language/tooling from package.json when present", async () => {
    mockReadFile.mockImplementation(async (path) => {
      if (String(path).endsWith("package.json")) {
        return JSON.stringify({
          packageManager: "pnpm@10.0.0",
          devDependencies: { vitest: "^4.0.0", turbo: "^2.0.0" },
        }) as never;
      }
      throw ENOENT;
    });
    mockAccess.mockRejectedValue(ENOENT);

    await seedEngineerMemory("/project");

    const [, , content] = mockSeedProjectMemory.mock.calls[0] as [string, string, string];
    expect(content).toContain("pnpm");
    expect(content).toContain("Vitest");
    expect(content).toContain("Turborepo");
  });

  it("includes content from AGENTS.md when present", async () => {
    mockReadFile.mockImplementation(async (path) => {
      if (String(path).endsWith("AGENTS.md")) {
        return "# AGENTS\n\nConventions here." as never;
      }
      throw ENOENT;
    });
    mockAccess.mockRejectedValue(ENOENT);

    await seedEngineerMemory("/project");

    const [, , content] = mockSeedProjectMemory.mock.calls[0] as [string, string, string];
    expect(content).toContain("Conventions here.");
  });

  it("still calls seedProjectMemory when package.json is missing", async () => {
    await seedEngineerMemory("/project");

    expect(mockSeedProjectMemory).toHaveBeenCalledOnce();
  });

  it("logs warn when seedProjectMemory returns an error", async () => {
    mockSeedProjectMemory.mockResolvedValue(EACCES);
    const warnSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await seedEngineerMemory("/project");

    const logged = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes("warn") && s.includes("memory.seed-failed"));
    expect(logged).toBeTruthy();
    warnSpy.mockRestore();
  });

  it("does not throw when seedProjectMemory returns an error", async () => {
    mockSeedProjectMemory.mockResolvedValue(EACCES);

    await expect(seedEngineerMemory("/project")).resolves.toBeUndefined();
  });

  it("resolves undefined on success", async () => {
    await expect(seedEngineerMemory("/project")).resolves.toBeUndefined();
  });
});
