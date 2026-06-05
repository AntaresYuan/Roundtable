# Spec 020: Agent Adapter Protocol

## Goal

Define a single interface that wraps any Coding Agent runtime (Claude Code CLI, OpenCode HTTP server, Codex CLI, Gemini CLI, or a Custom Agent built on Vercel AI SDK + MCP) so the Orchestrator can dispatch without knowing the downstream vendor.

## Non-goals

- Not the Orchestrator's decision logic (see spec 010).
- Not the UI for adding adapters (see `skills/add-agent-adapter`).

## Core idea

Every adapter exposes `createSession()` → `AgentSession`. Every session's `send()` returns an `AsyncIterable<AgentEvent>`. The Orchestrator consumes only the event stream; it never reaches into vendor-specific structures.

Adapters are the boundary between Roundtable's friendly UX and real terminal tools. They must preserve enough detail for debugging and audit, while normalizing vendor output into events the UI can render.

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

interface SessionOpts {
  sessionId?: string;
  cwd: string;
  systemPrompt?: string;
  mcpServers?: McpServerConfig[];
  allowedTools?: string[];
  role: AgentRoleId;
  agentMeta: {
    displayName: string;
    color: string;
  };
  budget?: {
    maxTokens?: number;
    maxRuntimeMs?: number;
  };
}

interface AgentSession {
  readonly id: string;
  readonly adapterId: string;
  readonly cwd: string;
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
  | { type: 'propose_skill'; name: string; triggerHint: string; body: string; rationale?: string }
  | { type: 'done'; usage?: TokenUsage; finishReason?: string }
  | { type: 'error'; message: string; recoverable: boolean };
```

## Event semantics

| Event | Meaning | UI behavior | Persistence |
|---|---|---|---|
| `thinking_delta` | Private or semi-private planning text. | Hidden or collapsed by default. | Optional, gated by privacy setting. |
| `text_delta` | User-readable progress or final answer. | Streams into agent bubble. | Stored as message chunks. |
| `tool_use` | Vendor tool call or shell action. | Tool card, collapsed by default. | Stored for audit. |
| `tool_result` | Output from a tool call. | Tool card update. | Stored with truncation policy. |
| `file_change` | Create/edit/delete in workspace. | Diff card and artifact extractor input. | Stored as patch metadata. |
| `artifact` | Renderable product object. | Artifact card. | Stored as versioned artifact. |
| `declare_dependency` | Agent declares an artifact relationship. | Feeds dependency graph reducer. | Stored in `artifact_deps`. |
| `propose_skill` | PM proposes saving a reusable pattern as a user-scoped skill (spec 100 L5, #100/#119). | "Save as my skill" confirm chip in chat. | Not persisted until the user clicks save → `user_skills` row. |
| `done` | Agent turn finished. | Marks TodoList item complete. | Stored on session run. |
| `error` | Adapter or agent failure. | Marks task failed; Orchestrator decides retry/fallback. | Stored with recoverability flag. |

Adapters may preserve raw vendor events in debug logs, but the Orchestrator must rely only on canonical events.

## Design principles

1. **Streaming first.** No accumulated `Promise<Reply>` interface.
2. **Flat events.** Each event is independently serializable for SSE/WebSocket transport.
3. **Discriminated unions.** Frontend / Orchestrator can `switch(event.type)` with full type safety.
4. **`declare_dependency` is a first-class event.** Not buried inside artifact metadata — it goes straight to the dependency-graph reducer.
5. **Human-readable by default.** Raw terminal output is captured, but the main UI renders structured progress and artifacts.
6. **Interruptible.** Every adapter must implement best-effort cancellation.

## Capabilities matrix

| Adapter | streaming | toolUse | fileEdits | persistentSessions | mcp | multimodal |
|---|---|---|---|---|---|---|
| `claude-code` | ✅ | ✅ | ✅ | ✅ (`--resume`) | ✅ | ✅ |
| `opencode` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| `codex` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ |
| `gemini-cli` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| `custom:<id>` | ✅ | ✅ | via MCP | via DB | ✅ | depends on model |

## Workspace isolation (hard requirement)

Each chat gets a `workspaces/<chatId>/` dir. `SessionOpts.cwd` is always this path. Adapters must not touch outside their `cwd`.

Rules:

- Reject absolute file writes outside `cwd`.
- Run CLI processes with `cwd` set explicitly.
- Store adapter session files under `.roundtable/sessions/<adapterId>/` inside the workspace when possible.
- Never pass repository-level secrets into user workspaces unless explicitly configured.
- Truncate command output before persistence; keep full logs only when debug mode is enabled.

## Adapter-specific strategies

### Claude Code

Use CLI process mode with structured output when available. Map tool calls and file edits into canonical events. Use persistent session support when it improves follow-up quality, but keep the HandoffCard as the source of cross-agent context.

### OpenCode

Prefer server/SSE mode. It is the best second adapter for proving the protocol because HTTP streaming avoids many CLI stdio edge cases.

### Codex

Treat as a demo-capable CLI adapter first. Focus on reliable task execution, review/fix roles, and `interrupt()` behavior before deep session persistence.

### Gemini CLI

Use for multimodal or broad planning/review tasks when available. Normalize file edits and command output the same way as other CLI adapters; do not expose Gemini-specific structures to the Orchestrator.

### Custom Agent

Run through Vercel AI SDK and MCP tools. This path is useful for user-created agents that do not need a full coding CLI.

## Test strategy

Each adapter must ship with:

- fixture stream covering text, tool use, file change, artifact, dependency, done, and error
- unit test for vendor-event-to-`AgentEvent` mapping
- interrupt smoke test
- workspace isolation test
- one integration test behind an opt-in env flag for live CLI execution

Unit tests must not call live LLMs.

## Acceptance criteria

- [ ] All supported adapters implement the same `AgentAdapter` interface — zero `instanceof` checks in the Orchestrator.
- [ ] All event types are documented in this spec (or in a linked sub-spec) before being emitted.
- [ ] An adapter is fully testable with a mock event stream — no live LLM calls in unit tests.
- [ ] Gemini CLI is represented in the protocol even if the first implementation is stubbed.
- [ ] Adapter sessions cannot write outside `SessionOpts.cwd` in isolation tests.
- [ ] `interrupt()` is implemented and documented per adapter.

## Open questions

- Should `interrupt()` be best-effort or guaranteed? Decided: best-effort for v1; document per-adapter behavior.
- Which adapters should be enabled for public users by default? Current bias: Claude Code + OpenCode for the first release, Codex/Gemini behind feature flags until reliability is measured.

## Changelog

- 2026-05-25 — added Gemini CLI, event semantics, isolation rules, adapter strategies, and test strategy.
- 2026-05-24 — initial draft.
