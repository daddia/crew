import { defineEval } from '@daddia/crew/evals';

export default defineEval({
  name: 'handoff',
  async run(t) {
    t.succeeded();
    t.expect(t.session.artefacts['jiraTransition'] === 'In Review', 'transitioned to In Review');
    t.expect(t.session.artefacts['terminalStep'] === 'in-review', 'terminal step is in-review');

    const handoff = t.session.artefacts['handoffEvent'] as
      { issueKey: string; mrUrl: string } | undefined;
    t.expect(
      typeof handoff?.issueKey === 'string' && handoff.issueKey.length > 0,
      'handoff has issueKey',
    );
    t.expect(
      typeof handoff?.mrUrl === 'string' && handoff.mrUrl.startsWith('https://'),
      'handoff has mrUrl',
    );
    t.expect(
      handoff?.issueKey === t.session.artefacts['issueKey'],
      'handoff issueKey matches fixture',
    );
    t.expect(handoff?.mrUrl === t.session.artefacts['mrUrl'], 'handoff mrUrl matches fixture');
  },
});
