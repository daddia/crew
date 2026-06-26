import { defineEval } from '@daddia/crew/evals';

export default defineEval({
  name: 'smoke',
  async run(t) {
    t.succeeded();
  },
});
