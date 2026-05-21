import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKSession } from '@anthropic-ai/claude-agent-sdk';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  unstable_v2_createSession: vi.fn(),
  unstable_v2_resumeSession: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
} from '@anthropic-ai/claude-agent-sdk';
import { access } from 'node:fs/promises';
import { resolveSession } from '../src/session.js';
import type { SessionOptions } from '../src/session.js';

const mockCreate = vi.mocked(unstable_v2_createSession);
const mockResume = vi.mocked(unstable_v2_resumeSession);
const mockAccess = vi.mocked(access);

function makeSession(sessionId: string): SDKSession {
  return {
    sessionId,
    send: vi.fn(),
    stream: vi.fn(),
    close: vi.fn(),
    [Symbol.asyncDispose]: vi.fn(),
  };
}

function makeOptions(overrides: Partial<SessionOptions> = {}): SessionOptions {
  return {
    definition: {
      name: 'engineer',
      promptPath: '/fake/prompt.md',
      skillPaths: [],
      subagentPaths: [],
      allowedTools: ['Read', 'Edit'],
      mcpServerNames: ['atlassian', 'gitlab'],
    },
    input: { issueKey: 'CREW-50-001', context: {} },
    resumeWithinMs: 60_000,
    model: 'claude-test',
    ...overrides,
  };
}

describe('resolveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: files are accessible.
    mockAccess.mockResolvedValue(undefined as never);
  });

  describe('create path', () => {
    it('calls unstable_v2_createSession when no previousSessionId is given', async () => {
      const fakeSession = makeSession('sdk-session-new');
      mockCreate.mockReturnValue(fakeSession);

      await resolveSession(makeOptions());

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-test',
        allowedTools: ['Read', 'Edit'],
        cwd: '/fake',
      });
      expect(mockResume).not.toHaveBeenCalled();
    });

    it('returns sessionId from the SDK session and isResumed false', async () => {
      const fakeSession = makeSession('sdk-session-abc');
      mockCreate.mockReturnValue(fakeSession);

      const result = await resolveSession(makeOptions());

      expect(result.sessionId).toBe('sdk-session-abc');
      expect(result.isResumed).toBe(false);
      expect(result.session).toBe(fakeSession);
    });

    it('creates a new session even when previousSessionId exists but resumeWithinMs is 0', async () => {
      const fakeSession = makeSession('sdk-session-fresh');
      mockCreate.mockReturnValue(fakeSession);

      const result = await resolveSession(makeOptions({ resumeWithinMs: 0 }), 'old-session-id');

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockResume).not.toHaveBeenCalled();
      expect(result.isResumed).toBe(false);
    });
  });

  describe('resume path', () => {
    it('calls unstable_v2_resumeSession when a previousSessionId exists', async () => {
      const fakeSession = makeSession('sess_abc');
      mockResume.mockReturnValue(fakeSession);

      await resolveSession(makeOptions(), 'sess_abc');

      expect(mockResume).toHaveBeenCalledOnce();
      expect(mockResume).toHaveBeenCalledWith('sess_abc', {
        model: 'claude-test',
        allowedTools: ['Read', 'Edit'],
        cwd: '/fake',
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('returns the previousSessionId and isResumed true', async () => {
      const fakeSession = makeSession('sess_abc');
      mockResume.mockReturnValue(fakeSession);

      const result = await resolveSession(makeOptions(), 'sess_abc');

      expect(result.sessionId).toBe('sess_abc');
      expect(result.isResumed).toBe(true);
      expect(result.session).toBe(fakeSession);
    });
  });

  describe('error propagation', () => {
    it('re-throws SDK errors on the create path and does not return a random UUID', async () => {
      const sdkError = new Error('Network error during session creation');
      mockCreate.mockImplementation(() => {
        throw sdkError;
      });

      await expect(resolveSession(makeOptions())).rejects.toThrow(
        'Network error during session creation',
      );
    });

    it('re-throws SDK errors on the resume path', async () => {
      const sdkError = new Error('Session not found');
      mockResume.mockImplementation(() => {
        throw sdkError;
      });

      await expect(resolveSession(makeOptions(), 'missing-session')).rejects.toThrow(
        'Session not found',
      );
    });
  });

  describe('subagent loading', () => {
    it('checks each subagent path for existence when non-empty', async () => {
      const fakeSession = makeSession('sdk-session-sub');
      mockCreate.mockReturnValue(fakeSession);

      await resolveSession(
        makeOptions({
          definition: {
            name: 'engineer',
            promptPath: '/agent/prompt.md',
            skillPaths: [],
            subagentPaths: [
              '/agent/.claude/agents/test-runner.md',
              '/agent/.claude/agents/linter.md',
            ],
            allowedTools: ['Read', 'Edit'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      expect(mockAccess).toHaveBeenCalledTimes(2);
      expect(mockAccess).toHaveBeenCalledWith('/agent/.claude/agents/test-runner.md');
      expect(mockAccess).toHaveBeenCalledWith('/agent/.claude/agents/linter.md');
    });

    it("passes settingSources: ['project'] when valid subagent paths exist", async () => {
      const fakeSession = makeSession('sdk-session-sub');
      mockCreate.mockReturnValue(fakeSession);

      await resolveSession(
        makeOptions({
          definition: {
            name: 'engineer',
            promptPath: '/agent/prompt.md',
            skillPaths: [],
            subagentPaths: ['/agent/.claude/agents/test-runner.md'],
            allowedTools: ['Read', 'Edit'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/agent',
          settingSources: ['project'],
        }),
      );
    });

    it('does not set settingSources when subagentPaths is empty', async () => {
      const fakeSession = makeSession('sdk-session-no-sub');
      mockCreate.mockReturnValue(fakeSession);

      await resolveSession(makeOptions());

      expect(mockAccess).not.toHaveBeenCalled();
      const callArg = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('settingSources');
    });

    it('warns and skips a subagent path that cannot be accessed', async () => {
      const fakeSession = makeSession('sdk-session-partial');
      mockCreate.mockReturnValue(fakeSession);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockAccess.mockRejectedValueOnce(enoent);

      await resolveSession(
        makeOptions({
          definition: {
            name: 'engineer',
            promptPath: '/agent/prompt.md',
            skillPaths: [],
            subagentPaths: ['/agent/.claude/agents/missing.md'],
            allowedTools: ['Read', 'Edit'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toContain('missing.md');
      warnSpy.mockRestore();
    });

    it('starts the session with remaining subagents after skipping a missing one', async () => {
      const fakeSession = makeSession('sdk-session-partial');
      mockCreate.mockReturnValue(fakeSession);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockAccess
        .mockRejectedValueOnce(enoent) // first path: missing
        .mockResolvedValueOnce(undefined as never); // second path: exists

      await resolveSession(
        makeOptions({
          definition: {
            name: 'engineer',
            promptPath: '/agent/prompt.md',
            skillPaths: [],
            subagentPaths: ['/agent/.claude/agents/missing.md', '/agent/.claude/agents/valid.md'],
            allowedTools: ['Read', 'Edit'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      // One valid path remains, so settingSources is still set.
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ settingSources: ['project'] }),
      );
    });

    it('does not set settingSources when all subagent paths are missing', async () => {
      const fakeSession = makeSession('sdk-session-all-missing');
      mockCreate.mockReturnValue(fakeSession);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockAccess.mockRejectedValue(enoent);

      await resolveSession(
        makeOptions({
          definition: {
            name: 'engineer',
            promptPath: '/agent/prompt.md',
            skillPaths: [],
            subagentPaths: ['/agent/.claude/agents/gone.md'],
            allowedTools: ['Read', 'Edit'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      const callArg = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('settingSources');
    });
  });

  describe('audit hook wiring', () => {
    it('passes a PostToolUse hook to the SDK when auditHook is provided', async () => {
      const fakeSession = makeSession('sdk-session-hook');
      mockCreate.mockReturnValue(fakeSession);
      const handler = vi.fn();

      await resolveSession(makeOptions({ auditHook: handler }));

      const callArg = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg).toHaveProperty('hooks');
      const hooks = callArg['hooks'] as Record<string, unknown>;
      expect(hooks).toHaveProperty('PostToolUse');
    });

    it('does not add a hooks field when auditHook is not provided', async () => {
      const fakeSession = makeSession('sdk-session-no-hook');
      mockCreate.mockReturnValue(fakeSession);

      await resolveSession(makeOptions());

      const callArg = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('hooks');
    });
  });
});
