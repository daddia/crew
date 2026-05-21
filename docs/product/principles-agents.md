Seven principles guide Agent crew design and development

1. **Specialised by design**: one crew, one step, one purpose. No crew spans a track. → _What a crew is_
2. **Context is seeded, not remembered**: every crew reads what it needs at start; nothing is assumed or carried over. → _How a crew starts_
3. **Resolve ambiguity before acting** — clarifying questions are raised at context-seed time, not mid-implementation. → _How a crew prepares_
4. **Stateless by default** — crews complete their task, hand off, and stop. No polling, no waiting, no hanging context. → _How a crew ends_
5. **Orchestrators poll, agents don't** — schedulers, webhooks, and pipelines trigger crews; agents never wait on infrastructure. → _What coordinates work_
6. **Deterministic toolchain first** — CI, SAST, unit tests, and linters run before agents touch a review. Don't spend tokens on what a tool can catch. → _What runs before agents_
7. **Entry and exit conditions are explicit** — a crew that doesn't know when it's done isn't a crew, it's a loop. → _What keeps crews honest_
