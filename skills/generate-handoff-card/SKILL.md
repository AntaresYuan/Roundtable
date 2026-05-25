---
name: generate-handoff-card
description: >-
  Generate a HandoffCard for a dispatch or agent-to-agent transfer. Used both
  as a build-time procedure (when authoring Orchestrator code) and as the
  runtime template the PM agent calls every time it hands off work. Triggers
  on "make a handoff", "dispatch to <agent>", or when the Orchestrator state
  machine reaches its Dispatch stage.
---

# Skill: Generate a HandoffCard

A HandoffCard is the only sanctioned vehicle for moving context between agents. Never inline chat history into a downstream agent's system prompt directly.

## Required inputs

- `from` — `'orchestrator'`, `'user'`, or an `AgentId`.
- `to` — the receiving `AgentId`.
- `scenario` — `dispatch | agent_handoff | join_group | cross_chat`.
- `userIntent` — one-sentence restatement of what the user originally asked for.
- `taskBrief` — one-paragraph description of *this turn's* job for the recipient.

## Procedure

1. Read the current group state (members, roles, recent N=20 messages).
2. Generate `userIntent` and `taskBrief` (use a cheap model — Haiku or equivalent).
3. Pull `pinnedMessages` from the chat's state (cap at 10).
4. Build `rolesInGroup` from the live member list.
5. If `from` is an agent: populate `previousAgent` with `summary`, `keyOutputs` (ArtifactRefs only, never inlined), and `openQuestions`.
6. Build `relevantArtifacts` — only artifacts plausibly relevant to `taskBrief`. **References only.**
7. Set `fullHistoryRef` to a pointer the downstream agent can call back to.
8. Emit the card to the chat surface (collapsed by default) **and** append a JSON line to `ai-logs/handoffs.jsonl`.

## Token-control rules

- N=3 most recent HandoffCards survive into the downstream system prompt in full.
- Older cards: keep `userIntent` + `keyOutputs`, drop the rest.
- No artifact bodies. Ever. Agents call `read_artifact(id)` if they need content.
- Cap `taskBrief` at 80 words. If you need more, split the task.

## Template (system-prompt injection)

```text
You are <role>. The PM has handed off the following task.

User intent: {{userIntent}}
Your job this turn: {{taskBrief}}

Global pinned constraints:
{{pinnedMessages}}

Group context:
{{rolesInGroup}}

{{#previousAgent}}
Previous agent: @{{previousAgent.agentId}}
  Summary: {{previousAgent.summary}}
  Outputs: {{previousAgent.keyOutputs}}
  Open questions: {{previousAgent.openQuestions}}
{{/previousAgent}}

Relevant artifacts (call read_artifact(id) to inspect):
{{relevantArtifacts}}

Full history available at: {{fullHistoryRef}}
```

## Acceptance

- [ ] Every dispatch emits exactly one card.
- [ ] No system prompt exceeds 8k tokens after injection.
- [ ] Every emitted card produces exactly one line in `ai-logs/handoffs.jsonl`.
- [ ] User can `[✎ Edit]` and re-dispatch; the edited card supersedes the original in the history.
