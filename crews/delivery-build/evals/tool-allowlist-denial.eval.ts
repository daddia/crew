import { defineEval } from '@daddia/crew/evals';

export default defineEval({
  name: 'tool-allowlist-denial',
  async run(t) {
    t.expect(t.session.artefacts['allowlistEnforced'] === true, 'allowlist guard denied the tool');
    t.expect(
      t.session.artefacts['deniedTool'] === 'mcp__gitlab__merge_merge_request',
      'merge tool was denied',
    );
    const denial = t.session.artefacts['denial'] as { tool: string; reason: string } | undefined;
    t.expect(denial?.tool === 'mcp__gitlab__merge_merge_request', 'denial event records the tool');
    t.expect(
      typeof denial?.reason === 'string' && denial.reason.includes('not in the allowed list'),
      'denial event records allowlist reason',
    );
  },
});
