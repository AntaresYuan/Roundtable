# CLAUDE.md — Claude Code Conventions

This file is read by Claude Code automatically. Other agents should read `AGENTS.md` first.

## Read order

1. `AGENTS.md` — repo-wide onboarding (applies to you too)
2. This file — Claude-Code-specific overrides
3. `specs/` for the feature area you are touching

## Tooling preferences

- Prefer `Edit` over `Write` when modifying existing files.
- Use `Bash` for shell-only operations; otherwise prefer `Read`/`Edit`/`Write`.
- When exploring an unfamiliar area, spawn an `Explore` subagent rather than reading many files yourself.
- Run `pnpm lint && pnpm test` after any non-trivial change. Do not ship code with a failing typecheck.

## Skills

`skills/` in this repo follows the Anthropic Skills format. You should auto-discover them. If you don't, run:

```bash
ls skills/
```

and read each `SKILL.md`. Currently:

- `add-agent-adapter` — when the user asks to integrate a new Coding Agent
- `write-orchestrator-prompt` — when modifying the PM agent's behavior
- `debug-stream-json` — when the Claude Code CLI bridge misbehaves
- `generate-handoff-card` — both a build-time procedure and the runtime template
- `release-checklist` — before tagging a release

## Code style

- TypeScript strict mode is on. Don't loosen it.
- Discriminated unions for event types. No `any` on the event stream.
- Async iterables for all agent output. No accumulated `Promise<Reply>` interfaces.
- Avoid comments that restate code. Only write a comment when the *why* is non-obvious.

## Commits

- One logical change per commit. No "fix typo + add feature + refactor" combo commits.
- Subject line ≤ 70 chars, imperative mood. See `rules/commit-message.md`.
- Do **not** add `Co-Authored-By: Claude` trailers. Commits go under the human author only.

## When you are uncertain

- If a spec exists, follow it. If the spec is wrong, update the spec in the same PR.
- If no spec exists for a load-bearing decision, draft an ADR in `ai-logs/decisions/` and link it from the PR.
- Capture surprising AI behavior in `ai-logs/incidents.md` with the prompt + wrong output + lesson learned.

## What lives where

```
src/
├── adapters/            # AgentAdapter implementations (one dir per agent)
├── orchestrator/        # LangGraph nodes for PM behavior
├── contracts/           # AgentEvent, Artifact, HandoffCard schemas (zod)
├── server/              # tRPC routers, db schema, auth
├── app/                 # Next.js App Router (routes: / and /gallery)
├── ui/                  # React components, fixtures (rt.js), design tokens
└── lib/                 # shared utilities (logger, fs, sandbox client)
```

Run the frontend with `pnpm ui:dev` (Next.js at localhost:3000). Build order: `specs/000-overview.md`.
