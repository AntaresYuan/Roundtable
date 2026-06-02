# Architecture Decision Records

Append-only. Use the template below. Number sequentially; never renumber.

## Index

- [ADR-001: Choose LangGraph.js over AutoGen for orchestration](./ADR-001-choose-langgraph-over-autogen.md)
- [ADR-002: Claude Code via CLI subprocess, not direct API](./ADR-002-claude-code-cli-vs-api.md)
- [ADR-003: HandoffCard as a structured object, not a free-form message](./ADR-003-handoff-card-format.md)
- [ADR-007: PM cannot create new Agents on the fly](./ADR-007-pm-cannot-create-new-agents.md)
- [ADR-008: Interaction model — Roundtable meeting with breakout rooms](./ADR-008-roundtable-meeting-interaction-model.md)

## Template

```markdown
# ADR-NNN: <Title>

## Status
Proposed | Accepted | Superseded by ADR-XXX

## Context
What forced the decision. Constraints. What we know.

## Decision
What we chose, in one paragraph.

## Why
Why this option over the alternatives. List the alternatives you considered
and why they lost.

## AI assistance
How AI helped us decide. Reference any prompts in `ai-logs/prompt-history/`.

## Consequences
What we now have to live with. What's harder. What's easier.
```
