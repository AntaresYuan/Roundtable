---
name: add-agent-adapter
description: >-
  Add a new Coding Agent adapter to Roundtable. Triggers when the user says
  "add a new agent", "support cursor", "integrate aider", "add <agent name>
  adapter", or asks how to plug a new CLI / HTTP-based coding agent into
  Roundtable.
---

# Skill: Add Agent Adapter

When the user asks to integrate a new Coding Agent (Cursor, Aider, an internal CLI, a custom MCP-based agent, etc.), follow this procedure end-to-end. Do **not** ship until every step has a check.

## Inputs you need from the user

1. Agent name and stable id (`kebab-case`, e.g. `aider`).
2. Transport: CLI subprocess, HTTP server, or in-process Vercel AI SDK call?
3. Streaming protocol it natively speaks (`stream-json`, SSE, NDJSON, OpenAI chat-completions, custom).
4. Whether it supports persistent sessions / `--resume` semantics.
5. Whether it can mount MCP servers.

If any of these are unclear, ask before writing code.

## Steps

1. **Create adapter directory** `src/adapters/<id>/` with `index.ts`, `adapter.ts`, `session.ts`, `event-mapper.ts`, `README.md`.
2. **Implement `AgentAdapter`** (see `specs/020-adapter-protocol.md`). Reuse the base class in `src/adapters/_base/` if subprocess-based.
3. **Implement the event mapper** — vendor stream → `AgentEvent` discriminated union. This is the only place vendor-specific types live.
4. **Register the adapter** in `src/adapters/registry.ts`.
5. **Add a spec entry** at `specs/agents/<id>.md` describing capabilities, known quirks, env vars.
6. **Add a test fixture** under `tests/adapters/<id>.test.ts` using a recorded event stream from `tests/adapters/<id>/fixtures/`. Tests must run without hitting a live LLM.
7. **Update the capabilities table** in `specs/020-adapter-protocol.md`.
8. **Update `AGENTS.md`** if the user-visible behavior changes.
9. **Run** `pnpm test --filter adapters && pnpm lint && pnpm typecheck`.

## Template

See `examples/adapter-template/` for a copy-pasteable scaffold. The template includes the standard `event-mapper.ts` shell with TODOs marking the only places you should need to fill in.

## Gotchas

- **stdio deadlock** — always consume `stderr` in parallel with `stdout`. A full stderr pipe buffer will freeze the child.
- **TTY detection** — most vendor CLIs change behavior when not attached to a TTY. Always pass the headless flag (`-p`, `--non-interactive`, etc.).
- **Auth isolation** — never let two adapters share an auth cache directory. Set `HOME` or vendor-specific config dir per `SessionOpts.cwd`.
- **Session resume** — if the vendor supports it, plumb `SessionOpts.sessionId` through. If not, document it in the capabilities matrix.
- See `ai-logs/incidents.md` for prior failures and their fixes.

## Acceptance

- [ ] New adapter passes the shared adapter conformance suite (`tests/adapters/_conformance.test.ts`).
- [ ] Capabilities table updated.
- [ ] Spec page exists at `specs/agents/<id>.md`.
- [ ] An ADR is added if the integration required protocol-level changes.
