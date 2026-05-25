# Spec 050: Group Chat — Routing & Observability

## Goal

Define how messages route between user and multiple agents in a group, how artifact ownership renders, and how agent-to-agent side-conversations stay observable without flooding the user.

## Non-goals

- Not the Orchestrator's internal decision logic (see spec 010).
- Not the dependency-graph mechanics (see spec 060).

## (a) `@mention` routing rules

| User intent | Routing |
|---|---|
| Explicit `@specific-agent` | Direct delivery; Orchestrator may stay silent. |
| No `@` mentioned | Orchestrator takes over (selector-style: reads context + agent descriptions, picks the next speaker). Orchestrator stays silent in the visible chat unless intervention is needed. |
| Multiple `@agents` | Parallel dispatch + multiple reply bubbles. |
| Agent A `@mentions` Agent B | Allowed; depth-2 limit on `agent → agent` chains. Orchestrator force-breaks on overflow. |
| User asks to invite a new agent | "Invite Agent" button; or Orchestrator proactively suggests when needed. |

**Guard:** when group has ≥ 4 agents and the user message has no `@`, the selector must include a confidence score. Below threshold, Orchestrator falls back to asking: "Do you want @frontend or @backend?"

## (b) Artifact ownership & multi-version

- Each agent has a fixed hex color (user-picked at creation, hash-derived fallback).
- Artifact card chrome: 1px colored border + agent avatar + role tag.
- Artifact updates create new versions (not new cards); old versions live in a timeline drawer.
- When ≥ 2 agents edit the same artifact: **last-write-wins** as the active version, but the diff is colored per-author so the user can see who changed which lines.
- A `@reviewer` role is a special case — it can only `propose`, never directly commit.

## (c) Side-conversation observability

- Default chat surface shows: user messages, agent **final** replies, and artifact cards.
- Agent-to-agent intermediate messages collapse to: `💬 @frontend and @reviewer talked 3 turns ▸`.
- Expanding reveals the sub-thread in a muted background.
- Every sub-thread surfaces a `💬 Interject` button so the user can interrupt or redirect (HITL entry point).

## (d) Chat surface composition

| Element | Source | When it appears |
|---|---|---|
| User bubble | user message | Always. |
| Agent reply bubble | agent's final `text_delta` aggregation | When agent emits `done`. |
| Artifact card (inline thumbnail) | `artifact` event | When an artifact is created or version-bumped. |
| HandoffCard (collapsed) | `handoff_emitted` orchestrator event | On every dispatch / hand-off. |
| TodoList card | orchestrator dispatch | Once per dispatch turn; updates in place. |
| Side-conversation chip | aggregated agent-to-agent events | When sub-thread has ≥ 2 messages. |
| Dependency-changed badge | dependency-graph reducer | On downstream artifact when upstream version bumps. |

## Acceptance criteria

- [ ] Routing decisions ship with a logged confidence score; below threshold ⇒ Orchestrator clarifies.
- [ ] Agent-to-agent depth > 2 always force-breaks with a synthesized summary.
- [ ] Multi-author diff renders with distinct per-author colors (≥ 2 visible).
- [ ] Side-conversation collapse / expand state is sticky per user per chat.

## Open questions

- Should the selector ever auto-invite a new agent (e.g., spot a security task → pull in `@security`)? v1: no; proactive invitation is suggested as a Quick Action only.

## Changelog

- 2026-05-24 — initial draft.
