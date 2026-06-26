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
import { SUBMIT_RESULT_TOOL_NAME } from '../src/result.js';
import { CODE_REVIEW_PLUGIN_PATH } from '../src/plugins.js';

const mockQuery = vi.mocked(query);
const mockAccess = vi.mocked(access);

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const engineerFixture = join(fixturesDir, 'engineer');
const codeReviewSkill = join(CODE_REVIEW_PLUGIN_PATH, 'skills', 'code-review', 'SKILL.md');

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
  beforeEach(async () => {
    vi.clearAllMocks();
    const { access: realAccess } =
      await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    mockAccess.mockImplementation(realAccess);
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

  describe('plugin loading', () => {
    it('checks each subagent path for existence when non-empty', async () => {
      await startSession(
        makeOptions({
          definition: {
            name: 'engineer',
            promptPath: join(engineerFixture, 'prompt.md'),
            skillPaths: [],
            subagentPaths: [
              join(engineerFixture, 'plugin', 'agents', 'test-runner.md'),
              join(engineerFixture, 'plugin', 'agents', 'linter.md'),
            ],
            allowedTools: ['Read', 'Edit'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      expect(mockAccess).toHaveBeenCalledWith(
        join(engineerFixture, 'plugin', 'agents', 'test-runner.md'),
      );
      expect(mockAccess).toHaveBeenCalledWith(
        join(engineerFixture, 'plugin', 'agents', 'linter.md'),
      );
    });

    it('passes explicit plugins when a persona plugin bundle exists', async () => {
      await startSession(
        makeOptions({
          definition: {
            name: 'engineer',
            promptPath: join(engineerFixture, 'prompt.md'),
            skillPaths: [],
            subagentPaths: [join(engineerFixture, 'plugin', 'agents', 'test-runner.md')],
            allowedTools: ['Read', 'Edit'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).not.toHaveProperty('settingSources');
      expect(options['plugins']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'local',
            path: join(engineerFixture, 'plugin'),
          }),
        ]),
      );
    });

    it('does not set plugins when persona has no plugin bundle and no shared plugins', async () => {
      await startSession(makeOptions());

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).not.toHaveProperty('plugins');
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
            promptPath: join(engineerFixture, 'prompt.md'),
            skillPaths: [],
            subagentPaths: [join(engineerFixture, 'plugin', 'agents', 'missing.md')],
            allowedTools: ['Read', 'Edit'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });
  });

  describe('skill loading', () => {
    it('Gherkin: a persona with skills but no subagents loads its skills via plugins', async () => {
      await startSession(
        makeOptions({
          definition: {
            name: 'senior-engineer',
            promptPath: '/agents/senior-engineer/prompt.md',
            skillPaths: [codeReviewSkill],
            subagentPaths: [],
            sharedPlugins: ['code-review'],
            allowedTools: ['Read'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      expect(mockAccess).toHaveBeenCalledWith(codeReviewSkill);
      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).not.toHaveProperty('settingSources');
      expect(options['plugins']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'local', path: CODE_REVIEW_PLUGIN_PATH }),
        ]),
      );
      expect(options['skills']).toEqual(['code-review:code-review']);

      const skillContent = await readFile(codeReviewSkill, 'utf8');
      expect(skillContent).toContain('code-review');
    });

    it('Gherkin: a persona with subagents still loads its skills via plugins', async () => {
      const implementStorySkill = join(
        engineerFixture,
        'plugin',
        'skills',
        'implement-story',
        'SKILL.md',
      );
      const testRunnerSubagent = join(engineerFixture, 'plugin', 'agents', 'test-runner.md');

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
      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options).not.toHaveProperty('settingSources');
      expect(options['skills']).toEqual(['engineer:implement-story']);
      expect(options['plugins']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'local', path: join(engineerFixture, 'plugin') }),
        ]),
      );

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
            promptPath: '/agents/senior-engineer/prompt.md',
            skillPaths: [join(CODE_REVIEW_PLUGIN_PATH, 'skills', 'missing', 'SKILL.md')],
            subagentPaths: [],
            sharedPlugins: ['code-review'],
            allowedTools: ['Read'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      expect(warnSpy).toHaveBeenCalledOnce();
      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options['skills']).toEqual(['code-review:code-review']);
      warnSpy.mockRestore();
    });

    it('Gherkin: clarify-only task enables only the matching skill body', async () => {
      const implementStorySkill = join(
        engineerFixture,
        'plugin',
        'skills',
        'implement-story',
        'SKILL.md',
      );
      const assessClarificationSkill = join(
        engineerFixture,
        'plugin',
        'skills',
        'assess-clarification',
        'SKILL.md',
      );

      const active = await startSession(
        makeOptions({
          input: {
            issueKey: 'CREW-50-001',
            context: { task: 'assess-clarification' },
          },
          definition: {
            name: 'engineer',
            promptPath: join(engineerFixture, 'prompt.md'),
            skillPaths: [implementStorySkill, assessClarificationSkill],
            subagentPaths: [],
            allowedTools: ['Read', 'Edit'],
            mcpServerNames: ['atlassian'],
          },
        }),
      );

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options['skills']).toEqual(['engineer:assess-clarification']);
      expect(active.skillCatalog).toHaveLength(2);
      expect(active.skillCatalog.map((entry) => entry.name).sort()).toEqual([
        'assess-clarification',
        'implement-story',
      ]);
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

    it('wires submit_result MCP server and allowlist when resultCapture is provided', async () => {
      const capture = {
        toolName: SUBMIT_RESULT_TOOL_NAME,
        mcpServers: { crew: { type: 'sdk' as const, name: 'crew' } },
        getSubmitted: () => undefined,
      };
      await startSession(makeOptions({ resultCapture: capture }));

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options['allowedTools']).toContain(SUBMIT_RESULT_TOOL_NAME);
      expect(options['mcpServers']).toMatchObject(capture.mcpServers);
    });
  });

  describe('workspace and bounds (RH01-12)', () => {
    it('uses workspaceCwd as SDK cwd when provided', async () => {
      await startSession(makeOptions({ workspaceCwd: '/workspace/acme' }));

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options['cwd']).toBe('/workspace/acme');
    });

    it('passes maxTurns and maxBudgetUsd to the SDK', async () => {
      await startSession(makeOptions({ maxTurns: 25, maxBudgetUsd: 3.5 }));

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options['maxTurns']).toBe(25);
      expect(options['maxBudgetUsd']).toBe(3.5);
    });

    it('passes inline sdkAgents and namespaced skill names', async () => {
      const implementStorySkill = join(
        engineerFixture,
        'plugin',
        'skills',
        'implement-story',
        'SKILL.md',
      );
      await startSession(
        makeOptions({
          workspaceCwd: '/workspace/acme',
          sdkAgents: {
            'test-runner': {
              description: 'Runs tests',
              prompt: 'Run pnpm test',
              tools: ['Bash'],
            },
          },
          definition: {
            name: 'engineer',
            promptPath: join(engineerFixture, 'prompt.md'),
            skillPaths: [implementStorySkill],
            subagentPaths: [],
            allowedTools: ['Read', 'Bash', 'Task'],
            mcpServerNames: ['gitlab'],
          },
        }),
      );

      const options = mockQuery.mock.calls[0]?.[0].options as Record<string, unknown>;
      expect(options['agents']).toMatchObject({
        'test-runner': { description: 'Runs tests' },
      });
      expect(options['skills']).toEqual(['engineer:implement-story']);
    });

    it('records subagent audit events when onSubagentAudit is provided', async () => {
      const onSubagentAudit = vi.fn();
      await startSession(makeOptions({ onSubagentAudit }));

      const options = mockQuery.mock.calls[0]?.[0].options as {
        hooks: {
          SubagentStart: Array<{ hooks: Array<(input: { hook_event_name: string; agent_type: string; agent_id: string }) => Promise<unknown>> }>;
        };
      };
      const hook = options.hooks.SubagentStart[0]?.hooks[0];
      await hook?.({
        hook_event_name: 'SubagentStart',
        agent_type: 'test-runner',
        agent_id: 'agent-1',
      });
      expect(onSubagentAudit).toHaveBeenCalledWith({
        phase: 'start',
        agentType: 'test-runner',
        agentId: 'agent-1',
      });
    });
  });
});
