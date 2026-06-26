import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runEvalFile, runEvalSuite } from '../../src/evals/runner.js';
import { runEvalCli } from '../../src/cli/eval.js';

async function toFetchRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const host = req.headers.host ?? '127.0.0.1';
  const url = `http://${host}${req.url ?? '/'}`;
  return new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
  });
}

async function startFixtureServer(
  fixtures: Record<string, () => Promise<{ success: boolean; summary: string; artefacts: Record<string, unknown>; costUsd: number }>>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const { createEvalFetchHandler } = await import('../../src/evals/server.js');
  const handler = createEvalFetchHandler({ fixtures });
  const server = createServer((req, res) => {
    void toFetchRequest(req)
      .then((request) => handler(request))
      .then((response) => {
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        return response.arrayBuffer();
      })
      .then((buf) => {
        res.end(Buffer.from(buf));
      })
      .catch((err: unknown) => {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : String(err));
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('runEvalFile', () => {
  let workspace: string;
  let crewDir: string;
  let server: { baseUrl: string; close: () => Promise<void> };

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'crew-eval-'));
    crewDir = join(workspace, 'crews', 'delivery-build');
    await mkdir(join(crewDir, 'evals'), { recursive: true });
    await mkdir(join(workspace, '.crew'), { recursive: true });
    await writeFile(join(workspace, '.crew', 'config'), 'schema_version: 0.1.0\n');

    server = await startFixtureServer({
      smoke: async () => ({
        success: true,
        summary: 'fixture smoke session',
        artefacts: { fixture: 'smoke' },
        costUsd: 0,
      }),
      failure: async () => ({
        success: false,
        summary: 'agent returned success:false',
        artefacts: {},
        costUsd: 0,
      }),
    });
  });

  afterEach(async () => {
    await server.close();
    await rm(workspace, { recursive: true, force: true });
  });

  it('smoke eval drives a real session and passes gate assertions (AC1)', async () => {
    const evalPath = join(crewDir, 'evals', 'smoke.eval.ts');
    await writeFile(
      evalPath,
      `import { defineEval } from '@daddia/crew/evals';
export default defineEval({
  name: 'smoke',
  async run(t) { t.succeeded(); },
});`,
    );

    const result = await runEvalFile({
      filePath: evalPath,
      crewDir,
      baseUrl: server.baseUrl,
    });

    expect(result.passed).toBe(true);
    expect(result.session.success).toBe(true);
    expect(result.fixture).toBe('smoke');
  });

  it('failed gate fails when agent returns success:false (AC2)', async () => {
    const evalPath = join(crewDir, 'evals', 'gate-fail.eval.ts');
    await writeFile(
      evalPath,
      `import { defineEval } from '@daddia/crew/evals';
export default defineEval({
  name: 'gate-fail',
  fixture: 'failure',
  async run(t) { t.succeeded(); },
});`,
    );

    const result = await runEvalFile({
      filePath: evalPath,
      crewDir,
      baseUrl: server.baseUrl,
    });

    expect(result.passed).toBe(false);
    expect(result.session.success).toBe(false);
  });
});

describe('runEvalCli', () => {
  let workspace: string;
  let crewDir: string;
  let server: { baseUrl: string; close: () => Promise<void> };

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'crew-eval-cli-'));
    crewDir = join(workspace, 'crews', 'delivery-build');
    await mkdir(join(crewDir, 'evals'), { recursive: true });
    await mkdir(join(workspace, '.crew'), { recursive: true });
    await writeFile(join(workspace, '.crew', 'config'), 'schema_version: 0.1.0\n');

    server = await startFixtureServer({
      smoke: async () => ({
        success: true,
        summary: 'ok',
        artefacts: {},
        costUsd: 0,
      }),
      failure: async () => ({
        success: false,
        summary: 'failed',
        artefacts: {},
        costUsd: 0,
      }),
    });
  });

  afterEach(async () => {
    await server.close();
    await rm(workspace, { recursive: true, force: true });
  });

  it('exits zero on passing smoke eval', async () => {
    await writeFile(
      join(crewDir, 'evals', 'smoke.eval.ts'),
      `import { defineEval } from '@daddia/crew/evals';
export default defineEval({ name: 'smoke', async run(t) { t.succeeded(); } });`,
    );

    const { exitCode } = await runEvalCli({
      cwd: workspace,
      crewName: 'delivery-build',
      files: [join(crewDir, 'evals', 'smoke.eval.ts')],
      baseUrl: server.baseUrl,
    });
    expect(exitCode).toBe(0);
  });

  it('exits non-zero when gate assertion fails', async () => {
    await writeFile(
      join(crewDir, 'evals', 'gate-fail.eval.ts'),
      `import { defineEval } from '@daddia/crew/evals';
export default defineEval({ name: 'gate-fail', fixture: 'failure', async run(t) { t.succeeded(); } });`,
    );

    const { exitCode } = await runEvalCli({
      cwd: workspace,
      crewName: 'delivery-build',
      files: [join(crewDir, 'evals', 'gate-fail.eval.ts')],
      baseUrl: server.baseUrl,
    });
    expect(exitCode).toBe(1);
  });

  it('discovers eval files when none are passed', async () => {
    await writeFile(
      join(crewDir, 'evals', 'smoke.eval.ts'),
      `import { defineEval } from '@daddia/crew/evals';
export default defineEval({ name: 'smoke', async run(t) { t.succeeded(); } });`,
    );

    const results = await runEvalSuite({
      crewDir,
      baseUrl: server.baseUrl,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
  });
});
