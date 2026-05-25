# Spec 030: HandoffCard

## Goal

Make every context transfer between agents (PM→agent, agent→agent, new-agent-joining, cross-chat) a structured, editable, replayable product object — not opaque message-passing.

## Non-goals

- Not chat-history compression (that lives in the per-adapter session layer).
- Not the visualization of dependency edges (see spec 060).

## Why this is load-bearing

Hand-off is the moment multi-agent systems lose information. By making the transfer an inspectable card with explicit fields, we get four wins:

1. **Token-efficient** — only the relevant subset is forwarded.
2. **Visible** — the user sees what was actually passed.
3. **Editable** — `[✎ Edit]` lets the user fix bad context before dispatch.
4. **Auditable** — every card is logged to `ai-logs/handoffs.jsonl` for review.

## Four scenarios

| Scenario | Trigger |
|---|---|
| `dispatch` | PM assigns a subtask to an agent. |
| `agent_handoff` | Agent A `@mentions` Agent B. |
| `join_group` | New agent invited mid-conversation. |
| `cross_chat` | Demo-only for the sprint: export from chat A, import to chat B. |

## Data shape

```ts
interface HandoffCard {
  id: string;
  from: AgentId | 'orchestrator' | 'user';
  to: AgentId;
  scenario: 'dispatch' | 'agent_handoff' | 'join_group' | 'cross_chat';

  userIntent: string;             // user's original ask, one sentence
  taskBrief: string;              // what this agent should do this turn

  pinnedMessages: PinnedMessage[]; // global constraints (≤ 10)
  rolesInGroup: AgentRoleSnapshot[];

  previousAgent?: {
    summary: string;
    keyOutputs: ArtifactRef[];
    openQuestions: string[];
  };

  relevantArtifacts: ArtifactRef[]; // ref, not inline content

  fullHistoryRef: string;          // pointer for fallback drill-down

  createdAt: Date;
  generatedBy: 'orchestrator';
}
```

## UI behavior

- Renders inline in the group chat as a collapsed one-liner: `🔄 hand-off → @backend`.
- Expand to show every field.
- `[✎ Edit]` opens an edit panel; the modified card is re-dispatched.
- Pinned to the top of the recipient's sub-thread for the duration of that subtask.

## Token-control rules

1. Carry at most the **N=3 most recent** HandoffCards into a downstream agent's system prompt.
2. For older cards, keep `userIntent` + `keyOutputs` refs; drop `previousAgent.summary`.
3. Artifacts are always **referenced**, never inlined. Agents call `read_artifact(id)` if needed.
4. Pinned messages are capped at 10 globally; FIFO eviction with user confirmation.

## Acceptance criteria

- [ ] Every cross-agent dispatch emits exactly one HandoffCard.
- [ ] No agent's system prompt exceeds 8k tokens before user input — enforced by a guard.
- [ ] `ai-logs/handoffs.jsonl` receives one line per card emission with `id`, `from`, `to`, `card_id`, `user_intent`.
- [ ] The user can edit any HandoffCard before its dispatch is consumed.

## Open questions

- Should the user be able to *block* a hand-off entirely? v1: no, but they can edit `taskBrief` to "do nothing, escalate to me."

## Changelog

- 2026-05-24 — initial draft.
