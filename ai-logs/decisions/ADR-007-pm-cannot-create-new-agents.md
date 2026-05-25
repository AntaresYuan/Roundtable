# ADR-007: PM cannot create new Agents on the fly

## Status

Accepted (2026-05-24)

## Context

During Orchestrator design, we considered letting the PM agent spawn new sub-agents dynamically (e.g., spot a security review need → instantiate a `@security` agent). This is appealing — "the system grows itself."

## Decision

**No.** The PM may *suggest* inviting a new agent via a Quick Action button, but cannot instantiate one without user confirmation.

## Why

- **Surface area control.** Dynamic agent creation widens the system's behavior space arbitrarily. We can't test what we can't enumerate.
- **Cost predictability.** Each agent has token cost; the user should see new costs before they incur.
- **Trust.** Users must understand who is in the room. Surprise members break the group-chat metaphor.
- **Demo legibility.** "PM proactively suggested @security, user confirmed" reads well. "PM silently spawned @security, here's the bill" does not.

## Alternatives considered

- **Allow with audit trail.** Rejected — audit trails don't fix the trust problem at the time of action.
- **Allow only from a fixed allowlist.** Equivalent to current behavior plus user-confirmation friction.

## AI assistance

- Claude Opus 4.7 argued *for* dynamic spawning in a brainstorm. We countered with the surface-area argument and the model accepted the position; logged that exchange to `ai-logs/prompt-history/2026-05-24-agent-spawn-debate.md`.

## Consequences

- Users see a `[Invite @security?]` Quick Action when the PM detects a need. They click to accept.
- The Orchestrator prompt explicitly forbids self-spawning.
- If a user requests "always auto-add agents you think are needed" — that's a per-chat setting we can add later, not a default.
