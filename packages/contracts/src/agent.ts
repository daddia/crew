/** Personas across all agent units. */
export type PersonaName = "tech-lead" | "engineer" | "senior-engineer" | "code-quality";

/** Input passed to every agent run. */
export interface AgentInput {
  /** Jira issue key, e.g. "ENG-123". */
  issueKey: string;
  /** Free-form context forwarded from the workflow. */
  context: Record<string, unknown>;
}

/** Result returned by every agent run. */
export interface AgentResult {
  /** Whether the agent considers its task complete and satisfactory. */
  success: boolean;
  /** Human-readable summary of what was done. */
  summary: string;
  /** Structured artefacts the workflow may act on (MR URL, review comments, …). */
  artefacts: Record<string, unknown>;
  /** Approximate model cost for this run in USD. */
  costUsd: number;
}

/** The interface every persona module must export. */
export interface Agent {
  readonly name: PersonaName;
  run(input: AgentInput): Promise<AgentResult>;
}

/** Definition used by the SDK to construct an Agent at runtime. */
export interface AgentDefinition {
  name: PersonaName;
  /** Absolute path to the persona's prompt.md. */
  promptPath: string;
  /** Absolute paths to all SKILL.md files the agent has access to. */
  skillPaths: string[];
  /** Absolute paths to subagent .md files (empty for MVP's tech-lead and senior-engineer). */
  subagentPaths: string[];
  /** Tool names this agent is permitted to call. Enforced as a hard filter. */
  allowedTools: string[];
  /** Keys into the unit's mcp.json servers map. */
  mcpServerNames: string[];
}
