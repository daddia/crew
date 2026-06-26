import { defineEval } from '@daddia/crew/evals';

export default defineEval({
  name: 'loop-cap-escalation',
  async run(t) {
    t.expect(
      t.session.artefacts['jiraTransition'] === 'Needs human review',
      'transitioned to Needs human review',
    );
    t.expect(t.session.artefacts['mrOpened'] === false, 'MR not opened after loop cap');
    const cap = t.session.artefacts['refactorLoopCap'] as number;
    const reviews = t.session.artefacts['peerReviewIterations'] as number;
    t.expect(reviews === cap + 1, `peer review ran to cap + 1 (${reviews} === ${cap} + 1)`);
    t.expect(
      t.session.artefacts['escalationReason'] === 'Refactor loop cap reached',
      'escalation reason is Refactor loop cap reached',
    );
  },
});
