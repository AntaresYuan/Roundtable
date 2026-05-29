# Roundtable — Agent Onboarding

> First file any agent (Claude Code, Cursor, OpenCode, Codex, custom) should read when entering this repo.

## What this is

IM-style platform where users chat with multiple Coding Agents in single/group rooms. An Orchestrator (PM) dispatches tasks, routes `@mentions`, maintains an artifact dependency graph, and surfaces hand-offs as first-class objects.

## Tech stack

Next.js 15 (App Router) · TypeScript · LangGraph.js · Vercel AI SDK · CopilotKit · tRPC · Drizzle + Postgres · e2b sandbox

## Where to start (by intent)

| If you want to... | Read this |
|---|---|
| Understand the product surface | `specs/000-overview.md` |
| Add a new Coding Agent (Cursor, Aider, etc.) | `skills/add-agent-adapter/SKILL.md` |
| Change Orchestrator behavior | `specs/010-orchestrator.md` |
| Modify the Adapter contract | `specs/020-adapter-protocol.md` |
| Modify the hand-off mechanism | `specs/030-handoff-card.md` |
| Understand artifact rendering | `specs/040-artifact-types.md` |
| Understand group-chat routing | `specs/050-group-chat.md` |
| Modify dependency graph | `specs/060-dependency-graph.md` |
| Author a new Skill | `specs/070-skills-system.md` |
| Debug Claude Code `stream-json` | `skills/debug-stream-json/SKILL.md` |
| Tune the Orchestrator prompt | `skills/write-orchestrator-prompt/SKILL.md` |
| Understand *why* a spec is shaped the way it is | `ai-logs/brainstorms/2026-05-21-roundtable-architecture.md` |

## Hard rules (read before touching code)

1. **No `console.log` in agent code paths** — use `logger.event()` so output joins the structured event stream.
2. **Every non-trivial PR must link a `specs/` doc or create an `ai-logs/decisions/` entry.** No silent architectural drift.
3. **No silent error swallowing** — agent errors must surface as an `{ type: 'error' }` event on the stream.
4. **Token budget** — never forward full history to a downstream agent; always go through a `HandoffCard` (see `specs/030`).
5. **English only in repo content** (code, docs, commits, PRs). Chat with the human team can be in any language.

## Run / Test / Lint

```bash
pnpm setup     # one-time: install deps + seed db + start docker services
pnpm dev       # next.js + langgraph dev server
pnpm test      # vitest (unit + integration)
pnpm lint      # eslint + prettier
pnpm typecheck # tsc --noEmit
```

## Project conventions

- File naming: `kebab-case` for files, `PascalCase` for React components, `camelCase` for variables.
- Adapter classes live in `src/adapters/<id>/`.
- Specs are numbered `NNN-topic.md`; **never renumber** — append-only.
- Schema changes go through Drizzle migrations; never edit a generated migration.

## Key decisions log

See `ai-logs/decisions/` for ADRs. If you're about to make a load-bearing architectural choice, add a new `ADR-NNN-*.md` before writing code.

## What to do if you're stuck

1. Search `specs/` for the topic.
2. Search `ai-logs/incidents.md` — someone may have already hit this.
3. Check `skills/` for a procedure that matches.
4. If still stuck, ask in the relevant GitHub issue and leave a note in `incidents.md` once resolved.
