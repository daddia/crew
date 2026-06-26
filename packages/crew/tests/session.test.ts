import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: vi.fn(),
  };
});

import { query } from '@anthropic-ai/claude-agent-sdk';
import { access } from 'node:fs/promises';
import { resolveSession } from '../src/session.js';
import type { SessionOptions } from '../src/session.js';

const mockQuery = vi.mocked(query);
const mockAccess = vi.mocked(access);

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const seniorEngineerFixture = join(fixturesDir, 'senior-engineer');
const engineerFixture = join(fixturesDir, 'engineer');
const peerCodeReviewSkill = join(
  seniorEngineerFixture,
  '.claude',
  'skills',
  'peer-code-review',
  'SKILL.md',
);

function makeQuery(messages: SDKMessage[] = []) {
  return {
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg;
      }
    },
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

async function startSession(
  options: SessionOptions,
  previousSessionId?: string,
  prompt = 'test prompt',
) {
  const active = await resolveSession(options, previousSessionId);
  await active.session.send(prompt);
  return active;
}

describe('resolveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined as never);
    mockQuery.mockReturnValue(makeQuery() as ReturnType<typeof query>);
  });

  describe('create path', () => {
    it('calls query when send runs and no previousSessionId is given', async () => {
      await startSession(makeOptions());

      expect(mockQuery).toHaveBeenCalledOnce();
      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test prompt',
        options: expect.objectContaining({
          model: 'claude-test',
          allowedTools: ['Read', 'Edit'],
          cwd: '/fake',
          sessionId: expect.any(String),
        }),
      });
      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).not.toHaveProperty('resume');
    });

    it('returns a new sessionId and isResumed false', async () => {
      const active = await resolveSession(makeOptions());

      expect(active.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(active.isResumed).toBe(false);
    });

    it('creates a new session even when previousSessionId exists but resumeWithinMs is 0', async () => {
      const active = await startSession(makeOptions({ resumeWithinMs: 0 }), 'old-session-id');

      expect(active.isResumed).toBe(false);
      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options['sessionId']).not.toBe('old-session-id');
      expect(options).not.toHaveProperty('resume');
    });
  });

  describe('resume path', () => {
    it('calls query with resume when a previousSessionId exists', async () => {
      await startSession(makeOptions(), 'sess_abc');

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test prompt',
        options: expect.objectContaining({
          resume: 'sess_abc',
          model: 'claude-test',
          allowedTools: ['Read', 'Edit'],
          cwd: '/fake',
        }),
      });
      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).not.toHaveProperty('sessionId');
    });

    it('returns the previousSessionId and isResumed true', async () => {
      const active = await startSession(makeOptions(), 'sess_abc');

      expect(active.sessionId).toBe('sess_abc');
      expect(active.isResumed).toBe(true);
    });
  });

  describe('error propagation', () => {
    it('re-throws SDK errors on the create path', async () => {
      mockQuery.mockImplementation(() => {
        throw new Error('Network error during session creation');
      });

      const active = await resolveSession(makeOptions());
      await expect(active.session.send('test')).rejects.toThrow(
        'Network error during session creation',
      );
    });

    it('re-throws SDK errors on the resume path', async () => {
      mockQuery.mockImplementation(() => {
        throw new Error('Session not found');
      });

      const active = await resolveSession(makeOptions(), 'missing-session');
      await expect(active.session.send('test')).rejects.toThrow('Session not found');
    });
  });

  describe('subagent loading', () => {
    it('checks each subagent path for existence when non-empty', async () => {
      await startSession(
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
      await startSession(
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

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            cwd: '/agent',
            settingSources: ['project'],
          }),
        }),
      );
    });

    it('does not set settingSources when subagentPaths and skillPaths are empty', async () => {
      await startSession(makeOptions());

      expect(mockAccess).not.toHaveBeenCalled();
      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).not.toHaveProperty('settingSources');
    });

    it('warns and skips a subagent path that cannot be accessed', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockAccess.mockRejectedValueOnce(enoent);

      await startSession(
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
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockAccess.mockRejectedValueOnce(enoent).mockResolvedValueOnce(undefined as never);

      await startSession(
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

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options['settingSources']).toEqual(['project']);
    });

    it('does not set settingSources when all subagent paths are missing', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockAccess.mockRejectedValue(enoent);

      await startSession(
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

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).not.toHaveProperty('settingSources');
    });
  });

  describe('skill loading', () => {
    it('Gherkin: a persona with skills but no subagents loads its skills', async () => {
      await startSession(
        makeOptions({
          definition: {
            name: 'senior-engineer',
            promptPath: join(seniorEngineerFixture, 'prompt.md'),
            skillPaths: [peerCodeReviewSkill],
            subagentPaths: [],
            allowedTools: ['Read'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      expect(mockAccess).toHaveBeenCalledWith(peerCodeReviewSkill);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            cwd: seniorEngineerFixture,
            settingSources: ['project'],
          }),
        }),
      );

      const skillContent = await readFile(peerCodeReviewSkill, 'utf8');
      expect(skillContent).toContain('peer-code-review');
    });

    it('Gherkin: a persona with subagents still loads its skills', async () => {
      const implementStorySkill = join(
        engineerFixture,
        '.claude',
        'skills',
        'implement-story',
        'SKILL.md',
      );
      const testRunnerSubagent = join(engineerFixture, '.claude', 'agents', 'test-runner.md');

      await startSession(
        makeOptions({
          definition: {
            name: 'engineer',
            promptPath: join(engineerFixture, 'prompt.md'),
            skillPaths: [implementStorySkill],
            subagentPaths: [testRunnerSubagent],
            allowedTools: ['Read', 'Edit'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      expect(mockAccess).toHaveBeenCalledWith(implementStorySkill);
      expect(mockAccess).toHaveBeenCalledWith(testRunnerSubagent);
      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options['settingSources']).toEqual(['project']);
      expect(options['cwd']).toBe(engineerFixture);

      const skillContent = await readFile(implementStorySkill, 'utf8');
      expect(skillContent).toContain('implement-story');
    });

    it('warns and skips a skill path that cannot be accessed', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockAccess.mockRejectedValueOnce(enoent);

      await startSession(
        makeOptions({
          definition: {
            name: 'senior-engineer',
            promptPath: join(seniorEngineerFixture, 'prompt.md'),
            skillPaths: [join(seniorEngineerFixture, '.claude', 'skills', 'missing', 'SKILL.md')],
            subagentPaths: [],
            allowedTools: ['Read'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toContain('skill file not found');
      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).not.toHaveProperty('settingSources');
      warnSpy.mockRestore();
    });

    it("passes settingSources: ['project'] when only valid skill paths exist", async () => {
      await startSession(
        makeOptions({
          definition: {
            name: 'senior-engineer',
            promptPath: join(seniorEngineerFixture, 'prompt.md'),
            skillPaths: [peerCodeReviewSkill],
            subagentPaths: [],
            allowedTools: ['Read'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options['settingSources']).toEqual(['project']);
    });
  });

  describe('audit hook wiring', () => {
    it('passes canUseTool and a PostToolUse hook when auditHook is provided', async () => {
      const handler = vi.fn();

      await startSession(makeOptions({ auditHook: handler }));

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).toHaveProperty('canUseTool');
      expect(typeof options['canUseTool']).toBe('function');
      expect(options).toHaveProperty('hooks');
      const hooks = options['hooks'] as Record<string, unknown>;
      expect(hooks).toHaveProperty('PostToolUse');
    });

    it('passes canUseTool even when auditHook is not provided', async () => {
      await startSession(makeOptions());

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).toHaveProperty('canUseTool');
      expect(typeof options['canUseTool']).toBe('function');
      expect(options).not.toHaveProperty('hooks');
    });

    it('denies disallowed tools via canUseTool before execution', async () => {
      const onDeny = vi.fn();
      await startSession(
        makeOptions({
          onToolDeny: onDeny,
          definition: {
            name: 'engineer',
            promptPath: '/fake/prompt.md',
            skillPaths: [],
            subagentPaths: [],
            allowedTools: ['mcp__gitlab__push_file'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      const options = mockQuery.mock.calls[0]?.[0].options as {
        canUseTool: (
          toolName: string,
          input: Record<string, unknown>,
          ctx: { signal: AbortSignal; toolUseID: string },
        ) => Promise<{ behavior: string; message?: string }>;
      };
      const result = await options.canUseTool(
        'mcp__gitlab__merge_request',
        { project_id: '123' },
        { signal: new AbortController().signal, toolUseID: 'toolu_1' },
      );

      expect(result.behavior).toBe('deny');
      expect(onDeny).toHaveBeenCalledOnce();
    });
  });
});
