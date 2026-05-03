# Skill: Review Code Quality

Use this skill when executing a code quality review of a merge request diff.

## Process

1. **Read the diff first.** Skim all changed files before forming any opinions. Note the scope: is this a refactor, a new feature, a bug fix?

2. **Load related context for non-trivial changes.** If a changed file imports modules or components that affect correctness, use `get_file_contents` or `search_code` to read the related code. Do not guess at patterns — read the actual codebase.

3. **Apply the review lenses in order:**
   - TypeScript correctness: narrowing, generics, discriminated unions, `as` casts, non-null assertions.
   - Error handling: are errors caught, propagated, or silently swallowed?
   - React component model: hook rules, effect dependencies, render stability.
   - Next.js patterns: server vs client boundaries, `use client` placement, fetch inside server components, correct use of `cache()` and `revalidate`.
   - Logic correctness: does the code do what the MR description says?

4. **Apply the do-not-duplicate rule before recording any finding.** Ask: would ESLint, TypeScript strict mode, or Prettier already flag this? If yes, omit it.

5. **Gate on confidence.** Only record findings where you are `high` or `medium` confidence. If you are uncertain, omit the finding.

6. **Format each finding precisely:**
   - `file`: exact relative path from repo root.
   - `line`: the line number in the diff (new file line, not context).
   - `title`: one sentence naming the issue.
   - `body`: problem + why it matters + suggested fix (three sentences max).

7. **Write the summary last**, after reviewing all findings. Two to three sentences. If there are no findings, say so plainly.

## Anti-patterns to avoid

- Do not flag things that are subjective style preferences.
- Do not invent non-existent APIs or patterns.
- Do not duplicate findings already in the list.
- Do not suggest rewrites larger than the scope of the MR.
- Do not add findings just to appear thorough. An empty findings list is valid.
