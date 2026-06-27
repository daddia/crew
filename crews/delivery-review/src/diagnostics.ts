/**
 * Pre-flight diagnostics for delivery-review.
 *
 * Checks that the runtime configuration is correct before starting the
 * server. Each check is independent and returns a name, ok flag, and
 * human-readable detail.
 */

import { access, constants, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { Config } from './config.js';
import { JIRA_JQL_SEARCH_PATH } from './integrations/jira.js';

const _dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_MCP_CONFIG_PATH = resolve(_dirname, '..', 'mcp.json');

const REQUIRED_TRANSITIONS = ['In Review', 'Done', 'Needs human review'] as const;

const MCP_HANDSHAKE_TIMEOUT_MS = 10_000;

export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DiagnosticsOptions {
  mcpConfigPath?: string;
  checkMcpServers?: (mcpConfigPath: string, env: NodeJS.ProcessEnv) => Promise<DiagnosticCheck>;
  checkDirWritable?: (dir: string) => Promise<DiagnosticCheck>;
}

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
 * Execute pre-flight checks against the supplied config.
 *
 * Checks (in order):
 *  1. Jira API reachability
 *  2. Jira project key exists
 *  3. Required Jira transitions available
 *  4. GitLab API reachability
 *  5. GitLab MR lookup smoke test
 *  6. MCP servers boot
 *  7. DB_PATH directory writable
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

  try {
    const searchParams = new URLSearchParams({
      jql: 'ORDER BY created DESC',
      fields: 'key',
      maxResults: '1',
    });
    const res = await fetch(`${baseUrl}/rest/api/3${JIRA_JQL_SEARCH_PATH}?${searchParams}`, {
      headers: jiraHeaders,
    });
    if (!res.ok) {
      checks.push({
        name: 'Jira API reachability',
        ok: false,
        detail: `GET ${JIRA_JQL_SEARCH_PATH} returned HTTP ${res.status}`,
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
            detail: 'all three required transitions present',
          });
        }
      }
    } catch (err) {
      checks.push({ name: 'Jira transitions', ok: false, detail: String(err) });
    }
  }

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

  const mrProbeKey = firstIssueKey ?? `${projectKey}-1`;
  try {
    const searchParams = new URLSearchParams({
      state: 'all',
      search: mrProbeKey,
      per_page: '1',
    });
    const res = await fetch(
      `${apiUrl}/projects/${encodeURIComponent(projectId)}/merge_requests?${searchParams}`,
      { headers: gitlabHeaders },
    );
    checks.push(
      res.ok
        ? {
            name: 'GitLab MR lookup',
            ok: true,
            detail: `MR search API responded for probe key ${mrProbeKey}`,
          }
        : {
            name: 'GitLab MR lookup',
            ok: false,
            detail: `MR search returned HTTP ${res.status}`,
          },
    );
  } catch (err) {
    checks.push({ name: 'GitLab MR lookup', ok: false, detail: String(err) });
  }

  checks.push(await checkMcpServers(mcpConfigPath, process.env));

  const dbDir = dirname(config.infrastructure.dbPath);
  checks.push(await checkDirWritable(dbDir));

  return checks;
}
