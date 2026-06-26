import { describe, it, expect, vi } from 'vitest';
import { buildAuditHook, buildToolAllowlistGuard, boundedIterGuard, IterationCapReached } from '../src/hooks.js';

describe('buildToolAllowlistGuard', () => {
  it('denies a disallowed tool before execution and records the denial', async () => {
    const onDeny = vi.fn();
    const guard = buildToolAllowlistGuard(['mcp__gitlab__push_file'], onDeny);

    const result = await guard(
      'mcp__gitlab__merge_request',
      { project_id: '123' },
      { signal: new AbortController().signal, toolUseID: 'toolu_1' },
    );

    expect(result).toEqual({
      behavior: 'deny',
      message: 'Tool "mcp__gitlab__merge_request" is not in the allowed list for this agent',
    });
    expect(onDeny).toHaveBeenCalledOnce();
    expect(onDeny).toHaveBeenCalledWith({
      tool: 'mcp__gitlab__merge_request',
      input: { project_id: '123' },
      reason: 'Tool "mcp__gitlab__merge_request" is not in the allowed list for this agent',
    });
  });

  it('allows a tool on the allowlist without recording a denial', async () => {
    const onDeny = vi.fn();
    const guard = buildToolAllowlistGuard(['mcp__gitlab__push_file'], onDeny);

    const result = await guard(
      'mcp__gitlab__push_file',
      { path: 'README.md' },
      { signal: new AbortController().signal, toolUseID: 'toolu_2' },
    );

    expect(result).toEqual({ behavior: 'allow' });
    expect(onDeny).not.toHaveBeenCalled();
  });
});

describe('buildAuditHook', () => {
  it('logs allowed tool use without enforcing the allowlist', () => {
    const log = vi.fn();
    const handler = buildAuditHook(log);

    handler({
      tool: 'mcp__gitlab__push_file',
      input: { path: 'README.md' },
      output: { ok: true },
      durationMs: 42,
    });

    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith({
      tool: 'mcp__gitlab__push_file',
      input: { path: 'README.md' },
      output: { ok: true },
      durationMs: 42,
    });
  });

  it('does not throw when logging a tool outside the legacy allowlist argument', () => {
    const log = vi.fn();
    const handler = buildAuditHook(['Read'], log);

    expect(() =>
      handler({
        tool: 'mcp__gitlab__merge_request',
        input: {},
        output: null,
        durationMs: 0,
      }),
    ).not.toThrow();
    expect(log).toHaveBeenCalledOnce();
  });
});

describe('boundedIterGuard', () => {
  it('allows iterations below the cap', () => {
    const guard = boundedIterGuard(3);
    expect(() => guard(0)).not.toThrow();
    expect(() => guard(2)).not.toThrow();
  });

  it('throws IterationCapReached when iteration reaches the cap', () => {
    const guard = boundedIterGuard(3);
    expect(() => guard(3)).toThrow(IterationCapReached);
    try {
      guard(3);
    } catch (err) {
      expect(err).toBeInstanceOf(IterationCapReached);
      expect((err as IterationCapReached).cap).toBe(3);
    }
  });
});
