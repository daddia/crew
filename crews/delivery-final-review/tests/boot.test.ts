import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@hono/node-server', () => ({
  serve: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

vi.mock('../src/state.js', () => ({
  createStateStore: vi.fn().mockReturnValue({
    close: vi.fn(),
  }),
}));

vi.mock('@daddia/crew', () => ({
  initTracing: vi.fn(),
}));

vi.mock('../src/observability.js', () => ({
  log: mockLog,
}));

import { boot } from '../src/index.js';
import { initTracing } from '@daddia/crew';
import { serve } from '@hono/node-server';

describe('boot – happy path', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('calls initTracing at boot with the crew service name', async () => {
    await boot({});
    expect(initTracing).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'delivery-final-review' }),
    );
  });

  it('emits exactly one config.loaded log line', async () => {
    await boot({});
    const calls = mockLog.info.mock.calls.filter((c) => c[0] === 'config.loaded');
    expect(calls).toHaveLength(1);
  });

  it('starts the HTTP server on the configured port', async () => {
    await boot({ PORT: '4001' });
    expect(serve).toHaveBeenCalledWith(expect.objectContaining({ port: 4001 }), expect.any(Function));
  });
});
