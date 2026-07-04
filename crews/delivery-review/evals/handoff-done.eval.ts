import { defineEval } from '@daddia/crew/evals';

export default defineEval({
  name: 'handoff-done',
  async run(t) {
    t.succeeded();
    t.expect(t.session.artefacts['jiraTransition'] === 'Done', 'transitioned to Done');
    t.expect(t.session.artefacts['terminalStep'] === 'done', 'terminal step is done');

    const handoff = t.session.artefacts['handoffDoneEvent'] as
      { issueKey: string; mrUrl: string; mergeCommitSha: string } | undefined;
    t.expect(
      typeof handoff?.issueKey === 'string' && handoff.issueKey.length > 0,
      'handoff-done has issueKey',
    );
    t.expect(
      typeof handoff?.mrUrl === 'string' && handoff.mrUrl.startsWith('https://'),
      'handoff-done has mrUrl',
    );
    t.expect(
      typeof handoff?.mergeCommitSha === 'string' && handoff.mergeCommitSha.length > 0,
      'handoff-done has mergeCommitSha',
    );
    t.expect(
      handoff?.issueKey === t.session.artefacts['issueKey'],
      'handoff-done issueKey matches fixture',
    );
    t.expect(handoff?.mrUrl === t.session.artefacts['mrUrl'], 'handoff-done mrUrl matches fixture');
    t.expect(
      handoff?.mergeCommitSha === t.session.artefacts['mergeCommitSha'],
      'handoff-done mergeCommitSha matches fixture',
    );
  },
});
