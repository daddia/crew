/**
 * Pre-flight diagnostics for delivery-build.
 *
 * Checks that the runtime configuration is correct before starting the
 * server. Each check is independent and returns a name, ok flag, and
 * human-readable detail. The CLI entry point (src/diagnose.ts) prints a
 * coloured one-line summary per check and exits with 0 (all pass) or 1 (any
 * fail).
 *
 * The optional `DiagnosticsOptions` object allows callers to inject the MCP
 * server boot check and the directory-writable check, making the function
 * fully unit-testable without spawning real processes or touching the
 * filesystem.
 */

import { access, constants, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { Config } from './config.js';

const _dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolved at import time so the default path is relative to this file, which
 * works correctly whether the module is loaded from `src/` (Vitest) or from
 * the compiled `dist/` (production).
 */
const DEFAULT_MCP_CONFIG_PATH = resolve(_dirname, '..', 'mcp.json');

const REQUIRED_TRANSITIONS = [
  'In Progress',
  'Clarification Needed',
  'In QA',
  'Needs human review',
] as const;

const MCP_HANDSHAKE_TIMEOUT_MS = 10_000;

export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DiagnosticsOptions {
  /**
   * Override the path to `mcp.json`. Defaults to the `mcp.json` at the crew
   * root, two levels above this compiled module.
   */
  mcpConfigPath?: string;

  /**
   * Inject a replacement for the MCP server boot check. When provided, the
   * default spawn-and-handshake logic is skipped entirely. Receives the
   * resolved mcp.json path and the current `process.env`.
   */
  checkMcpServers?: (mcpConfigPath: string, env: NodeJS.ProcessEnv) => Promise<DiagnosticCheck>;

  /**
   * Inject a replacement for the DB directory writable check. Receives the
   * directory path derived from `config.infrastructure.dbPath`.
   */
  checkDirWritable?: (dir: string) => Promise<DiagnosticCheck>;
}

// ── MCP server shapes ─────────────────────────────────────────────────────────

interface McpServerDef {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers: Record<string, McpServerDef>;
}

function interpolateEnv(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => env[name] ?? '');
}

/**
 * Spawn one MCP server process, send the JSON-RPC `initialize` request, and
 * wait for any JSON-RPC response on stdout. Returns ok: true if the server
 * responds within the timeout.
 */
async function pingMcpServer(
  name: string,
  def: McpServerDef,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; detail: string }> {
  const resolvedEnv: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(def.env ?? {}).map(([k, v]) => [k, interpolateEnv(v, env)]),
  );

  return new Promise((res) => {
    let settled = false;
    let output = '';

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(def.command, def.args ?? [], {
        env: { ...env, ...resolvedEnv },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      res({ ok: false, detail: `${name}: failed to spawn — ${String(err)}` });
      return;
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        res({ ok: false, detail: `${name}: timed out waiting for MCP handshake` });
      }
    }, MCP_HANDSHAKE_TIMEOUT_MS);

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        res({ ok: false, detail: `${name}: spawn error — ${err.message}` });
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        res({
          ok: false,
          detail: `${name}: process exited with code ${code ?? 'null'} before handshake`,
        });
      }
    });

    // stdio: ["pipe","pipe","pipe"] guarantees these are non-null, but the
    // ChildProcess type marks them as nullable because other stdio modes exist.
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('"jsonrpc"') || output.includes('"result"')) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          res({ ok: true, detail: `${name}: MCP handshake succeeded` });
        }
      }
    });

    const initRequest =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'diagnostics', version: '1.0.0' },
        },
      }) + '\n';

    child.stdin?.write(initRequest);
  });
}

async function defaultCheckMcpServers(
  mcpConfigPath: string,
  env: NodeJS.ProcessEnv,
): Promise<DiagnosticCheck> {
  const checkName = 'MCP servers boot';

  let raw: string;
  try {
    raw = await readFile(mcpConfigPath, 'utf-8');
  } catch {
    return {
      name: checkName,
      ok: false,
      detail: `mcp.json not found at ${mcpConfigPath}`,
    };
  }

  let mcpConfig: McpConfig;
  try {
    mcpConfig = JSON.parse(raw) as McpConfig;
  } catch {
    return { name: checkName, ok: false, detail: 'mcp.json is not valid JSON' };
  }

  const serverEntries = Object.entries(mcpConfig.mcpServers);
  if (serverEntries.length === 0) {
    return { name: checkName, ok: true, detail: 'no MCP servers configured' };
  }

  const failures: string[] = [];
  for (const [serverName, def] of serverEntries) {
    const result = await pingMcpServer(serverName, def, env);
    if (!result.ok) {
      failures.push(result.detail);
    }
  }

  if (failures.length > 0) {
    return { name: checkName, ok: false, detail: failures.join('; ') };
  }

  return {
    name: checkName,
    ok: true,
    detail: `all ${serverEntries.length} MCP server(s) responded to initialize`,
  };
}

async function defaultCheckDirWritable(dir: string): Promise<DiagnosticCheck> {
  const checkName = 'DB_PATH directory writable';
  try {
    await access(dir, constants.W_OK);
    return { name: checkName, ok: true, detail: dir };
  } catch {
    return { name: checkName, ok: false, detail: `${dir} is not writable` };
  }
}

/**
 * Execute all six pre-flight checks against the supplied config and return
 * one `DiagnosticCheck` per check. The function never throws; each check
 * catches its own errors and surfaces them as `ok: false` with a detail
 * message.
 *
 * Checks (in order):
 *  1. Jira API reachability
 *  2. Jira project key exists
 *  3. Four required Jira transitions available (probed on the first issue)
 *  4. GitLab API reachability
 *  5. MCP servers boot (spawn + JSON-RPC initialize handshake)
 *  6. DB_PATH directory is writable
 */
export async function runDiagnostics(
  config: Config,
  options: DiagnosticsOptions = {},
): Promise<DiagnosticCheck[]> {
  const {
    mcpConfigPath = DEFAULT_MCP_CONFIG_PATH,
    checkMcpServers = defaultCheckMcpServers,
    checkDirWritable = defaultCheckDirWritable,
  } = options;

  const { baseUrl, email, projectKey } = config.identity.jira;
  const jiraAuthHeader =
    'Basic ' +
    Buffer.from(`${email}:${String(config.secrets.atlassianApiToken)}`).toString('base64');
  const jiraHeaders: HeadersInit = {
    Authorization: jiraAuthHeader,
    Accept: 'application/json',
  };

  const gitlabToken = String(config.secrets.gitlabAccessToken);
  const { apiUrl, projectId } = config.identity.gitlab;
  const gitlabHeaders: HeadersInit = { 'PRIVATE-TOKEN': gitlabToken };

  const checks: DiagnosticCheck[] = [];
  let firstIssueKey: string | undefined;

  // ── Check 1: Jira API reachability ──────────────────────────────────────────
  try {
    const res = await fetch(
      `${baseUrl}/rest/api/3/issue/search?jql=ORDER+BY+created+DESC&fields=key&maxResults=1`,
      { headers: jiraHeaders },
    );
    if (!res.ok) {
      checks.push({
        name: 'Jira API reachability',
        ok: false,
        detail: `GET /issue/search returned HTTP ${res.status}`,
      });
    } else {
      const data = (await res.json()) as { issues: Array<{ key: string }> };
      firstIssueKey = data.issues[0]?.key;
      checks.push({
        name: 'Jira API reachability',
        ok: true,
        detail: `${baseUrl} is reachable`,
      });
    }
  } catch (err) {
    checks.push({
      name: 'Jira API reachability',
      ok: false,
      detail: String(err),
    });
  }

  // ── Check 2: Jira project key exists ────────────────────────────────────────
  try {
    const res = await fetch(`${baseUrl}/rest/api/3/project/${encodeURIComponent(projectKey)}`, {
      headers: jiraHeaders,
    });
    checks.push(
      res.ok
        ? {
            name: 'Jira project key',
            ok: true,
            detail: `project ${projectKey} exists`,
          }
        : {
            name: 'Jira project key',
            ok: false,
            detail: `project ${projectKey} returned HTTP ${res.status}`,
          },
    );
  } catch (err) {
    checks.push({ name: 'Jira project key', ok: false, detail: String(err) });
  }

  // ── Check 3: Required Jira transitions available ─────────────────────────────
  if (!firstIssueKey) {
    checks.push({
      name: 'Jira transitions',
      ok: false,
      detail: 'no issues found — cannot probe transitions',
    });
  } else {
    try {
      const res = await fetch(`${baseUrl}/rest/api/3/issue/${firstIssueKey}/transitions`, {
        headers: jiraHeaders,
      });
      if (!res.ok) {
        checks.push({
          name: 'Jira transitions',
          ok: false,
          detail: `GET /issue/${firstIssueKey}/transitions returned HTTP ${res.status}`,
        });
      } else {
        const data = (await res.json()) as {
          transitions: Array<{ name: string; to: { name: string } }>;
        };
        const availableNames = new Set(data.transitions.flatMap((t) => [t.name, t.to.name]));
        const missing = REQUIRED_TRANSITIONS.filter((t) => !availableNames.has(t));
        if (missing.length > 0) {
          checks.push({
            name: 'Jira transitions',
            ok: false,
            detail: `missing transitions: ${missing.join(', ')}`,
          });
        } else {
          checks.push({
            name: 'Jira transitions',
            ok: true,
            detail: 'all four required transitions present',
          });
        }
      }
    } catch (err) {
      checks.push({ name: 'Jira transitions', ok: false, detail: String(err) });
    }
  }

  // ── Check 4: GitLab API reachability ────────────────────────────────────────
  try {
    const res = await fetch(`${apiUrl}/projects/${encodeURIComponent(projectId)}`, {
      headers: gitlabHeaders,
    });
    checks.push(
      res.ok
        ? {
            name: 'GitLab API reachability',
            ok: true,
            detail: `${apiUrl} is reachable`,
          }
        : {
            name: 'GitLab API reachability',
            ok: false,
            detail: `GET /projects/${projectId} returned HTTP ${res.status}`,
          },
    );
  } catch (err) {
    checks.push({ name: 'GitLab API reachability', ok: false, detail: String(err) });
  }

  // ── Check 5: MCP servers boot ────────────────────────────────────────────────
  checks.push(await checkMcpServers(mcpConfigPath, process.env));

  // ── Check 6: DB_PATH directory writable ─────────────────────────────────────
  const dbDir = dirname(config.infrastructure.dbPath);
  checks.push(await checkDirWritable(dbDir));

  return checks;
}
