# Spec 020: Agent Adapter Protocol

## Goal

Define a single interface that wraps any Coding Agent runtime (Claude Code CLI, OpenCode HTTP server, Codex CLI, or a Custom Agent built on Vercel AI SDK + MCP) so the Orchestrator can dispatch without knowing the downstream vendor.

## Non-goals

- Not the Orchestrator's decision logic (see spec 010).
- Not the UI for adding adapters (see `skills/add-agent-adapter`).

## Core idea

Every adapter exposes `createSession()` → `AgentSession`. Every session's `send()` returns an `AsyncIterable<AgentEvent>`. The Orchestrator consumes only the event stream; it never reaches into vendor-specific structures.

## TypeScript contract

See `src/contracts/adapter.ts` (TBD). Key shapes:

```ts
interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly avatar: string;
  readonly capabilities: AgentCapabilities;
  createSession(opts: SessionOpts): Promise<AgentSession>;
}

interface AgentSession {
  readonly id: string;
  send(input: UserInput): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

type AgentEvent =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: unknown; isError?: boolean }
  | { type: 'file_change'; path: string; kind: 'create' | 'edit' | 'delete'; diff: string }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'declare_dependency'; from: string; to: string; kind: DepKind }
  | { type: 'done'; usage?: TokenUsage; finishReason?: string }
  | { type: 'error'; message: string; recoverable: boolean };
```

## Design principles

1. **Streaming first.** No accumulated `Promise<Reply>` interface.
2. **Flat events.** Each event is independently serializable for SSE/WebSocket transport.
3. **Discriminated unions.** Frontend / Orchestrator can `switch(event.type)` with full type safety.
4. **`declare_dependency` is a first-class event.** Not buried inside artifact metadata — it goes straight to the dependency-graph reducer.

## Capabilities matrix

| Adapter | streaming | toolUse | fileEdits | persistentSessions | mcp | multimodal |
|---|---|---|---|---|---|---|
| `claude-code` | ✅ | ✅ | ✅ | ✅ (`--resume`) | ✅ | ✅ |
| `opencode` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| `codex` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ |
| `custom:<id>` | ✅ | ✅ | via MCP | via DB | ✅ | depends on model |

## Workspace isolation (hard requirement)

Each chat gets a `workspaces/<chatId>/` dir. `SessionOpts.cwd` is always this path. Adapters must not touch outside their `cwd`.

## Acceptance criteria

- [ ] All four adapters implement the same `AgentAdapter` interface — zero `instanceof` checks in the Orchestrator.
- [ ] All event types are documented in this spec (or in a linked sub-spec) before being emitted.
- [ ] An adapter is fully testable with a mock event stream — no live LLM calls in unit tests.

## Open questions

- Should `interrupt()` be best-effort or guaranteed? Decided: best-effort for v1; document per-adapter behavior.

## Changelog

- 2026-05-24 — initial draft.
