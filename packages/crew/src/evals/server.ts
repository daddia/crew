import type { EvalFixtureRunner, EvalServerOptions, EvalSessionResult } from './types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function handleEvalHealth(options: EvalServerOptions): Promise<Response> {
  return jsonResponse({
    ok: true,
    fixtures: Object.keys(options.fixtures),
  });
}

async function handleEvalSession(req: Request, options: EvalServerOptions): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body !== 'object' || body === null) {
    return jsonResponse({ error: 'Body must be an object' }, 400);
  }

  const fixture = (body as Record<string, unknown>)['fixture'];
  if (typeof fixture !== 'string' || !fixture.trim()) {
    return jsonResponse({ error: 'fixture is required' }, 400);
  }

  const runner: EvalFixtureRunner | undefined = options.fixtures[fixture];
  if (!runner) {
    return jsonResponse({ error: `Unknown fixture: ${fixture}` }, 404);
  }

  try {
    const result: EvalSessionResult = await runner();
    return jsonResponse(result);
  } catch {
    return jsonResponse({ error: 'Eval session failed' }, 500);
  }
}

function requestUrl(req: Request): URL {
  try {
    return new URL(req.url);
  } catch {
    return new URL(req.url, 'http://127.0.0.1');
  }
}

/**
 * Web-standard fetch handler for CrewBench eval routes.
 * Mount at `/eval/*` on any crew HTTP server.
 */
export function createEvalFetchHandler(
  options: EvalServerOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = requestUrl(req);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if ((path === '/eval' || path === '/eval/health') && req.method === 'GET') {
      return handleEvalHealth(options);
    }

    if (path === '/eval/session' && req.method === 'POST') {
      return handleEvalSession(req, options);
    }

    return new Response('Not Found', { status: 404 });
  };
}
