# Code Review Rules

Reviewers and authors share responsibility. These rules describe what a review *must* cover, not how to be polite (assume kindness).

## Reviewer's required passes

1. **Spec alignment.** Does the code match the linked spec? If the spec is wrong, request a spec update in the same PR.
2. **Contract integrity.** Anything in `src/contracts/` changed? Check that all consumers compile.
3. **Event stream invariants.** Adapter changes: do all `AgentEvent` types still produce well-formed events? See spec 020.
4. **Token budget.** Orchestrator / hand-off changes: is the N=3 cap respected? Are artifacts referenced, not inlined?
5. **Workspace isolation.** Any subprocess invocation that could write outside `SessionOpts.cwd`?
6. **Test coverage.** New behavior comes with a test. Bug fixes come with a regression test built from a fixture.

## Author's pre-review checklist

- [ ] Walk through your own diff once, top to bottom. Leave inline comments explaining non-obvious choices.
- [ ] Self-flag risks: "this might affect <X>" — make it easy for the reviewer.
- [ ] Provide a manual test plan when the change isn't covered by automated tests (UI, sandbox, network).

## When AI assisted the change

Mention it in the PR description, briefly:

> Implementation drafted with Claude Code; reviewed and adjusted by <name>. Notable AI miss: <X>, corrected to <Y>.

This is **not** an attribution requirement (commits stay under the human author). It is a quality signal for the reviewer.

## Disagreement protocol

- Reviewer requests changes ⇒ author either makes them or replies with reasoning. No silent dismissal.
- If consensus stalls, escalate by tagging a third reviewer or moving the discussion to an ADR draft.

## Merge authority

- Author may merge after all `Changes requested` threads are resolved and CI is green.
- Force-pushing after review approval requires re-review.
