import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createEvalFetchHandler } from '@daddia/crew/evals';
import { createEvalFixtures } from './fixtures.js';

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

export interface EvalServerHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

/** Lightweight HTTP server exposing only CrewBench /eval/* routes (mock fixtures). */
export async function startEvalServer(port = 0): Promise<EvalServerHandle> {
  const handler = createEvalFetchHandler({
    fixtures: createEvalFixtures('mock'),
  });

  const server: Server = createServer((req, res) => {
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

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
