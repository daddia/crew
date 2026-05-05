# Adding a Persona

Personas are the team members inside an agent crew. Each persona owns a prompt, a skill set, and an allowed-tools list, and is wired into the crew's workflow.

## Directory layout

Create a new directory under the crew's `agents/` folder:

```
crews/delivery/src/agents/<name>/
  agent.ts       # exports const <name>: Agent
  prompt.md      # system prompt — no code
  .claude/
    skills/      # SKILL.md files loaded via readSkillsDir()
    agents/      # subagent .md files loaded via readSubagentsDir()
```

## Steps

1. **Scaffold the directory** following the layout above.
2. **Write `agent.ts`** — export a single named `const` typed as `Agent`:

   ```typescript
   export const reviewer: Agent = {
     name: 'reviewer',
     async run(input: AgentInput): Promise<AgentResult> { ... }
   }
   ```

   Call `resolveSession()` to decide create vs resume, build an `AgentDefinition`, attach `buildAuditHook()`, and return `AgentResult`.

3. **Write `prompt.md`** — describe the persona's role, responsibilities, and constraints. No code in this file.

4. **Define `allowedTools`** — list only the tools this persona needs. `buildAuditHook` enforces the allowlist at runtime.

5. **Wire into `workflow.ts`** — import the persona and add it to the delivery sequence. Follow the existing escalation pattern (loop cap → comment → transition → return).

6. **Add tool-scoping tests** — add a test case to `tests/agent-tool-scoping.test.ts` that asserts the persona's allowlist contains no unexpected tools.

## Checklist

- [ ] `agent.ts` exports a single named `const` typed as `Agent`
- [ ] `prompt.md` exists and contains no code
- [ ] `allowedTools` is explicitly defined and minimal
- [ ] Persona is wired into `workflow.ts`
- [ ] Tool-scoping test added
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
