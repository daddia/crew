Seven principles guide Agent crew design and development

1. **Specialised by design**: one crew, one step, one purpose. No crew spans a track. → *What a crew is*
2. **Context is seeded, not remembered**: every crew reads what it needs at start; nothing is assumed or carried over. → *How a crew starts*
3. **Resolve ambiguity before acting** — clarifying questions are raised at context-seed time, not mid-implementation. → *How a crew prepares*
4. **Stateless by default** — crews complete their task, hand off, and stop. No polling, no waiting, no hanging context. → *How a crew ends*
5. **Orchestrators poll, agents don't** — schedulers, webhooks, and pipelines trigger crews; agents never wait on infrastructure. → *What coordinates work*
6. **Deterministic toolchain first** — CI, SAST, unit tests, and linters run before agents touch a review. Don't spend tokens on what a tool can catch. → *What runs before agents*
7. **Entry and exit conditions are explicit** — a crew that doesn't know when it's done isn't a crew, it's a loop. → *What keeps crews honest*
