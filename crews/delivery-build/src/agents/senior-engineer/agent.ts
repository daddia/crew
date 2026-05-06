import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveSession,
  readPromptFile,
  readSkillsDir,
  readSubagentsDir,
  buildAuditHook,
  type SDKResultMessage,
  type Agent,
  type AgentDefinition,
  type AgentInput,
  type AgentResult,
} from "@daddia/crew";

/**
 * Flatten a single comment entry from the peer-code-review JSON output.
 * Accepts either a pre-formatted string or a structured object with path,
 * line, category, observed, and remediation fields.
 */
function flattenComment(c: unknown, index: number): string {
  if (typeof c === "string") return c;
  if (typeof c === "object" && c !== null && !Array.isArray(c)) {
    const co = c as Record<string, unknown>;
    return `${String(co["path"] ?? "")}:${String(co["line"] ?? "")} [${String(co["category"] ?? "")}] ${String(co["observed"] ?? "")} — ${String(co["remediation"] ?? "")}`;
  }
  throw new Error(`Comment at index ${index} has unexpected type`);
}

/**
 * Parse the structured JSON artefact emitted by the peer-code-review skill.
 * Expected shape: { verdict: "approved" | "changes-requested", comments: [...] }
 *
 * Throws a descriptive Error on any parse or validation failure so the caller
 * can produce a structured `success: false` result with an excerpt of the raw
 * result included in the summary.
 */
export function parseReviewResult(raw: string): {
  verdict: "approved" | "changes-requested";
  comments: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `JSON parse failure: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Result is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  const { verdict, comments } = obj;

  if (verdict !== "approved" && verdict !== "changes-requested") {
    throw new Error(`Unexpected verdict value: ${String(verdict)}`);
  }

  if (!Array.isArray(comments)) {
    throw new Error("comments field is not an array");
  }

  return {
    verdict,
    comments: comments.map(flattenComment),
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const ALLOWED_TOOLS = [
  // GitLab MCP — read-only + comments
  "mcp__gitlab__get_merge_request",
  "mcp__gitlab__list_merge_request_diffs",
  "mcp__gitlab__get_file_contents",
  "mcp__gitlab__create_note",
  "mcp__gitlab__list_branches",
  // Atlassian MCP — read-only
  "mcp__atlassian__jira_get_issue",
];

const RESUME_WITHIN_MS = 0; // peer review always starts fresh
const DEFAULT_MODEL = "claude-opus-4-5";

async function buildDefinition(): Promise<AgentDefinition> {
  const base = __dirname;
  const [skillPaths, subagentPaths] = await Promise.all([
    readSkillsDir(join(base, ".claude", "skills")),
    readSubagentsDir(join(base, ".claude", "agents")),
  ]);

  return {
    name: "senior-engineer",
    promptPath: join(base, "prompt.md"),
    skillPaths,
    subagentPaths,
    allowedTools: ALLOWED_TOOLS,
    mcpServerNames: ["atlassian", "gitlab"],
    memory: "project",
  };
}

async function run(input: AgentInput): Promise<AgentResult> {
  const definition = await buildDefinition();
  const prompt = await readPromptFile(definition.promptPath);

  const auditHook = buildAuditHook(definition.allowedTools, () => {});

  const { session, sessionId } = await resolveSession(
    {
      definition,
      input,
      resumeWithinMs: RESUME_WITHIN_MS,
      model: (input.context["model"] as string | undefined) ?? DEFAULT_MODEL,
      auditHook,
    },
  );

  // SECURITY: input.context is constructed by the workflow from trusted
  // internal values (task, mrUrl, diff). Never pass user-supplied data
  // here without sanitising it first.
  const taskPrompt = [
    prompt,
    "---",
    `Issue: ${input.issueKey}`,
    `Context: ${JSON.stringify(input.context)}`,
  ].join("\n\n");

  try {
    await session.send(taskPrompt);

    let resultMsg: SDKResultMessage | undefined;
    for await (const msg of session.stream()) {
      if (msg.type === "result") {
        resultMsg = msg;
        break;
      }
    }

    if (!resultMsg) {
      return {
        success: false,
        summary: "Session ended without a result message",
        artefacts: { sessionId },
        costUsd: 0,
      };
    }

    if (resultMsg.subtype === "success") {
      let verdict: "approved" | "changes-requested";
      let comments: string[];

      try {
        ({ verdict, comments } = parseReviewResult(resultMsg.result));
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const excerpt = resultMsg.result.slice(0, 500);
        return {
          success: false,
          summary: `${errMsg} — raw result excerpt: ${excerpt}`,
          artefacts: { sessionId },
          costUsd: resultMsg.total_cost_usd,
        };
      }

      return {
        success: verdict === "approved",
        summary: resultMsg.result,
        artefacts: {
          sessionId,
          comments: verdict === "approved" ? [] : comments,
        },
        costUsd: resultMsg.total_cost_usd,
      };
    }

    return {
      success: false,
      summary: resultMsg.errors.join("; "),
      artefacts: { sessionId },
      costUsd: resultMsg.total_cost_usd,
    };
  } catch (err) {
    return {
      success: false,
      summary: err instanceof Error ? err.message : String(err),
      artefacts: { sessionId },
      costUsd: 0,
    };
  } finally {
    await session[Symbol.asyncDispose]();
  }
}

export const seniorEngineer: Agent = {
  name: "senior-engineer",
  run,
};
