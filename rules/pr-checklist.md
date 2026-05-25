# PR Checklist

Every PR must pass this checklist before merge. The author ticks; the reviewer verifies.

## Hygiene

- [ ] Title in Conventional Commits style (`<type>(<scope>): summary`).
- [ ] PR description states *what* and *why* in plain English. Link related specs / ADRs / issues.
- [ ] No `console.log`, no commented-out code, no `TODO` without an owner.
- [ ] No AI-attribution trailers anywhere.

## Quality gates

- [ ] `pnpm lint` clean (or warnings pre-date this PR).
- [ ] `pnpm typecheck` zero errors.
- [ ] `pnpm test` zero failures.
- [ ] New code has tests. UI changes have at least a smoke / interaction test.
- [ ] If you touched an Orchestrator prompt: eval pass rate ≥ 90%.

## Documentation

- [ ] If you changed an interface in `src/contracts/`, the relevant spec is updated in the same PR.
- [ ] If you changed the repo structure, `AGENTS.md` is updated.
- [ ] If you made a load-bearing decision, an ADR exists at `ai-logs/decisions/`.
- [ ] If your change exposed a recurring AI failure mode, an `ai-logs/incidents.md` entry is added.

## Scope

- [ ] One logical change. Refactors that "happen to fix a bug" are split.
- [ ] No drive-by changes outside the stated scope.

## Review

- [ ] At least one human reviewer. AI review is welcome as a *second* pass, never the only one.
- [ ] All review threads resolved or explicitly deferred to a follow-up issue.

## Merge

- We use squash-merge with the PR title as the commit subject. Edit the title to keep history readable.
- No force-push to `main`.
