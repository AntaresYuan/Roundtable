---
name: release-checklist
description: >-
  Pre-tag review before cutting a Roundtable release. Triggers when the user
  says "cut a release", "tag v0.X", "prepare release", "ship it", or asks for
  the release procedure.
---

# Skill: Release Checklist

Roundtable is pre-alpha; releases are sprint-end snapshots, not semver-stable. Even so, every tag needs a clean state.

## Pre-tag checks

- [ ] `git status` is clean. No untracked files outside `.gitignore` rules.
- [ ] `pnpm install --frozen-lockfile` succeeds from a clean clone.
- [ ] `pnpm typecheck` — zero errors.
- [ ] `pnpm lint` — zero errors (warnings allowed if they pre-date this PR).
- [ ] `pnpm test` — zero failures. Flaky tests must be fixed or quarantined with a linked issue, not skipped silently.
- [ ] `pnpm eval orchestrator` — pass rate ≥ 90%.
- [ ] Smoke test: run the demo script in `scripts/smoke.ts` end-to-end with at least one adapter live.

## Documentation checks

- [ ] `AGENTS.md` Quick Links table reflects current spec count.
- [ ] Every spec listed in `AGENTS.md` actually exists.
- [ ] `README.md` "Status" section updated.
- [ ] Any new ADRs in `ai-logs/decisions/` are linked from at least one spec.
- [ ] No `TODO(release)` / `FIXME(release)` markers in `src/`.

## Tag & push

```bash
git tag -a v0.X.0 -m "Roundtable v0.X.0 — <short summary>"
git push origin v0.X.0
```

GitHub Release notes draft lives at `docs/releases/v0.X.0.md`. Populate before tagging.

## Post-tag

- [ ] Open a "Post-release retro" issue. Link incidents discovered during the sprint.
- [ ] Snapshot the current Orchestrator prompt to `ai-logs/prompt-history/orchestrator-v0.X.0.md`.
- [ ] Update `ai-logs/decisions/` index if a new ADR was added in this cycle.

## Acceptance

- [ ] All checkboxes above are ticked.
- [ ] CI is green on the tagged commit.
- [ ] Release notes are published.
