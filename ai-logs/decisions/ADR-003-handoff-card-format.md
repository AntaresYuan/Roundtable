# ADR-003: HandoffCard as a structured object, not a free-form message

## Status

Accepted (2026-05-23)

## Context

When an agent hands off work to another agent, the receiving agent needs context. Two patterns exist:

1. **Free-form**: PM writes a paragraph in the chat; the downstream agent reads recent N messages.
2. **Structured**: PM emits a typed `HandoffCard` object with explicit fields (`userIntent`, `taskBrief`, `previousAgent.summary`, `relevantArtifacts`, etc.); chat history is referenced, not inlined.

## Decision

Structured HandoffCard. See `specs/030-handoff-card.md`.

## Why

- **Token control.** Free-form means dumping chat history; that breaks past ~10 turns. Structured lets us forward only the relevant subset and cap downstream system prompts.
- **User intervention.** A typed card can be edited in the UI before dispatch. Free-form text in a chat bubble cannot.
- **Auditability.** Every card is appended to `ai-logs/handoffs.jsonl`. We can replay any prior dispatch.
- **Product surface.** Visible, editable hand-offs are a key differentiator (`specs/000-overview.md`). Free-form would be invisible.
- **Token-efficiency at scale.** With N=3 retention + ref-only artifacts, system prompts stay under 8k.

## Alternatives considered

- **JSON appended at the end of a free-form message.** Rejected — still pays the cost of chat-history forwarding and is harder for the UI to render.
- **Function-calling hand-off (vendor-specific).** Rejected — couples us to one model vendor.

## AI assistance

- The original card shape came from a brainstorm with Claude Opus 4.7 (see `ai-logs/prompt-history/2026-05-21-handoff-brainstorm.md`). We then pruned fields until every one had a UI use case.

## Consequences

- Orchestrator must generate cards reliably. We pay one cheap-model call per dispatch.
- UI must render and edit cards (`HandoffCardComponent` in `src/ui/`).
- A new contract in `src/contracts/handoff.ts` — versioned with care.
- New "edit a hand-off" interaction surface, which is also a demo highlight.
