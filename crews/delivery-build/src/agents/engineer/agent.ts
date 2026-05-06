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

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Parse the structured JSON artefact emitted by the engineer skills.
 * Accepts any of the three shapes: assess-clarification, implement-story,
 * or address-feedback.
 *
 * The skills instruct the model to emit a full AgentResult envelope:
 *   { success, summary, artefacts: { ... }, costUsd }
 * When that envelope is present this function returns the inner `artefacts`
 * object plus the envelope's boolean `success` flag (or undefined when the
 * field is absent or non-boolean). When no envelope is detected the
 * top-level object is returned as the artefacts and `envelopeSuccess` is
 * undefined.
 *
 * Throws a descriptive Error on parse or structural failure so the caller
 * can produce a `success: false` result with an excerpt of the raw result.
 */
export function parseEngineerArtefacts(raw: string): {
  artefacts: Record<string, unknown>;
  envelopeSuccess: boolean | undefined;
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
  if (
    typeof obj["artefacts"] === "object" &&
    obj["artefacts"] !== null &&
    !Array.isArray(obj["artefacts"])
  ) {
    return {
      artefacts: obj["artefacts"] as Record<string, unknown>,
      envelopeSuccess:
        typeof obj["success"] === "boolean" ? obj["success"] : undefined,
    };
  }

  return { artefacts: obj, envelopeSuccess: undefined };
}

const ALLOWED_TOOLS = [
  // GitLab MCP
  "mcp__gitlab__create_branch",
  "mcp__gitlab__push_file",
  "mcp__gitlab__list_branches",
  "mcp__gitlab__get_file_contents",
  "mcp__gitlab__create_merge_request",
  "mcp__gitlab__get_merge_request",
  "mcp__gitlab__update_merge_request",
  "mcp__gitlab__create_note",
  // Atlassian MCP
  "mcp__atlassian__jira_get_issue",
  "mcp__atlassian__jira_add_comment",
  // Bash — intentionally omitted for MVP; add when test execution is wired in
];

const RESUME_WITHIN_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MODEL = "claude-opus-4-5";

async function buildDefinition(): Promise<AgentDefinition> {
  const base = __dirname;
  const [skillPaths, subagentPaths] = await Promise.all([
    readSkillsDir(join(base, ".claude", "skills")),
    readSubagentsDir(join(base, ".claude", "agents")),
  ]);

  return {
    name: "engineer",
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

  const previousSessionId =
    typeof input.context["previousSessionId"] === "string"
      ? input.context["previousSessionId"]
      : undefined;

  const { session, sessionId, isResumed } = await resolveSession(
    {
      definition,
      input,
      resumeWithinMs: RESUME_WITHIN_MS,
      model: (input.context["model"] as string | undefined) ?? DEFAULT_MODEL,
      auditHook,
    },
    previousSessionId,
  );

  // SECURITY: input.context is constructed by the workflow from trusted
  // internal values (task, mrUrl, comments). Never pass user-supplied data
  // here without sanitising it first.
  const taskPrompt = isResumed
    ? `Continue with the current task.\nIssue: ${input.issueKey}\nContext: ${JSON.stringify(input.context)}`
    : [
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
      let parsedArtefacts: Record<string, unknown>;
      let envelopeSuccess: boolean | undefined;
      try {
        ({ artefacts: parsedArtefacts, envelopeSuccess } = parseEngineerArtefacts(
          resultMsg.result,
        ));
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

      // The skill envelope lets the model self-report a blocker via
      // success: false. Honour that so the workflow can escalate cleanly
      // instead of falling through to a "missing branchName" failure.
      return {
        success: envelopeSuccess !== false,
        summary: resultMsg.result,
        artefacts: { sessionId, ...parsedArtefacts },
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

export const engineer: Agent = {
  name: "engineer",
  run,
};
