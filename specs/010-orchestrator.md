# Spec 010: Orchestrator (PM)

## Goal

Define how the PM agent intakes user requests, optionally clarifies, plans, dispatches to subordinate agents, monitors execution, and aggregates results back to the user.

## Non-goals

- Not how individual Coding Agents work (see spec 020).
- Not the data shape of a hand-off (see spec 030).
- Not artifact rendering (see spec 040).

## Core value

> Stay silent unless speaking adds value. Stay short unless detail is required.

The Orchestrator is a *good PM*, not a verbose narrator.

## State machine

Six stages run for every user message:

```
[1 Intake] → [2 Clarify?] → [3 Plan] → [4 Dispatch] → [5 Monitor] → [6 Aggregate]
```

- **Intake** — light LLM call classifies the message on three axes: clarity (clear / ambiguous), complexity (trivial / multi-step), type (build / inspect / control). Output drives routing.
- **Clarify** — entered only when ambiguity score > 0.6. Max 3 questions. Always rendered as a structured card with selectable options (generative UI, not free text).
- **Plan** — emits a structured YAML plan: `{id, title, assignee, deps, parallel}`. Cuts by role, never by file.
- **Dispatch** — emits a *single* TodoList message that names every assignee and shows live status badges (⏳ / 🚀 / ✅ / ❌).
- **Monitor** — silent unless: an agent fails, an agent stalls > 60s, two agents conflict, or an agent-to-agent `@mention` loop exceeds depth 2.
- **Aggregate** — short summary + Quick Action buttons. Never restates what subordinate agents already shipped.

## Decision rules

- Clarify only when ambiguity score > 0.6.
- Plan only when ≥ 2 roles are needed; otherwise dispatch directly to a single agent.
- Conflict resolution order: auto 3-way merge → if fails, surface diff cards to user → if user is absent, defer to the dependency graph's authoritative side.

## Acceptance criteria

- [ ] PM does not clarify on unambiguous requests (≥ 90% of `intake.clear` cases skip clarify).
- [ ] PM emits a TodoList message on every multi-task dispatch (100%).
- [ ] PM aggregate message ≤ 4 lines + artifact list.
- [ ] PM never produces free-form clarification text — always structured cards.
- [ ] On agent failure, PM auto-retries once before surfacing to user.

## Prompt

Lives in `prompts/orchestrator.md` (TBD). Versioned per release; old versions snapshotted to `ai-logs/prompt-history/`.

## Open questions

- Should Plan be visible to the user by default? Decided: **no** (collapsed behind "show plan").
- Should the user be able to override the Plan? Yes — see HandoffCard `[✎ Edit]` flow in spec 030.

## Changelog

- 2026-05-24 — initial draft.
