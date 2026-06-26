import { defineEval } from '@daddia/crew/evals';

export default defineEval({
  name: 'handoff-artefact',
  async run(t) {
    t.succeeded();
    t.expect(t.session.artefacts['jiraTransition'] === 'In QA', 'transitioned to In QA');
    t.expect(t.session.artefacts['terminalStep'] === 'in-qa', 'terminal step is in-qa');

    const handoff = t.session.artefacts['handoffEvent'] as
      | { issueKey: string; mrUrl: string }
      | undefined;
    t.expect(typeof handoff?.issueKey === 'string' && handoff.issueKey.length > 0, 'handoff has issueKey');
    t.expect(
      typeof handoff?.mrUrl === 'string' && handoff.mrUrl.startsWith('https://'),
      'handoff has mrUrl',
    );
    t.expect(handoff?.issueKey === t.session.artefacts['issueKey'], 'handoff issueKey matches fixture');
    t.expect(handoff?.mrUrl === t.session.artefacts['mrUrl'], 'handoff mrUrl matches fixture');
  },
});
