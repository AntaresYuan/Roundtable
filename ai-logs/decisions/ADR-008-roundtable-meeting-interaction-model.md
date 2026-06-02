# ADR-008: Interaction model — Roundtable meeting with breakout rooms

## Status

Accepted (2026-05-31)

## Context

The product is named **Roundtable**; its thesis is "group-chat semantics for agents."
The frontend is unstarted as of 2026-05-31, so the primary interaction metaphor is still
open. Three candidates surfaced in design discussion:

1. **IM group chat** (飞书/微信) — the PRD's original framing.
2. **Ambient "office"** of agent characters at desks you watch work (cf. Marvis).
3. **Meeting room / roundtable + breakout rooms** (Zoom-like), with a facilitator and
   sub-groups that peel off and report back.

Two hard constraints shaped the choice:

- The moat features all need a **document/content surface**: `@mention` routing
  (spec 050), the editable `HandoffCard` (spec 030), artifact/diff/preview rendering
  (spec 040), the dependency-changed badge (spec 060). A purely spatial view cannot hold
  a diff or an editable card.
- **3-person team, 3-week sprint, UI behind the W1 critical path.** Whatever we pick must
  have a thin, demo-able slice — no Zoom clone, no fully animated office.

The model must serve three collaboration axes: human↔human (the reference we borrow
from), human↔agent, and agent↔agent.

## Decision

The organizing metaphor is a **Roundtable meeting with first-class breakout rooms**,
layered over an IM-chat substrate — **not** an ambient office, and **not** a node-canvas.

- The group chat is the **main table**. The Orchestrator is the **facilitator** (silent
  unless it adds value).
- Agent↔agent side-conversations and PM-pulled sub-groups become **breakout rooms** the
  user can observe and **enter** (interject) — an elevation of spec 050's currently
  collapsed `💬 talked N turns` chip into a room you can step into.
- `HandoffCard`s are the context you carry **into and out of** a breakout. Artifacts,
  diffs, and previews remain **cards opened within** the room — the spatial layer never
  replaces the content surface.

**Sprint scope = thin slice:** one main table + **one enterable breakout** (the API
field-rename conflict, issue #31) + human interject. Parallel multi-breakout, ambient
presence/animation, and the office layer are explicitly deferred.

## Why

- **On-brand and thesis-expressing.** The name is Roundtable; the meeting metaphor
  literally renders "group-chat semantics for agents" and all three collaboration axes.
- **Breakout rooms make agent↔agent collaboration visible and interventable** — directly
  powering the conflict-resolution scenario the brainstorm calls a defense highlight, and
  the "observable + HITL" differentiator that Coze/Bolt lack.
- **Low conceptual cost.** It reuses existing semantics (specs 050/030/010) instead of
  inventing a new model — the chat we were already building is the table's substrate.
- **Innovates on human collaboration, doesn't just copy it.** Agents aren't bound by
  human meeting limits: true parallel breakouts, perfect auto-minutes (HandoffCard +
  aggregate), and rewindable/editable hand-offs. Pitch: *"like a meeting, without the
  inefficiency of one."*

## Alternatives considered

- **Ambient office of agent characters (Marvis-style).** Rejected as the *organizing*
  metaphor: it is charm, not thesis, and it is read-only — you watch, you can't enter or
  edit — so it cannot host `@mention` / HandoffCard / diff / HITL. May be borrowed later
  as a "lobby/home" presence layer, never as the workspace.
- **Pure IM group chat (original PRD framing).** Not rejected but *subsumed*: chat is the
  rendering substrate of a table's conversation; the meeting/breakout framing sits on top
  and promotes side-conversations from a collapsed chip to an enterable room.
- **Node-graph canvas (Coze-style).** Rejected — PRD §7 explicitly positions against the
  canvas; coordination should emerge from conversation, not a wiring diagram.

## AI assistance

This metaphor emerged in a 2026-05-31 design brainstorm with Claude (Claude Code, Opus),
sparked by the user sharing the Marvis office UI and asking whether to reference its
multi-agent interaction style. Claude mapped human-meeting patterns onto existing
Roundtable mechanics, argued office-as-charm versus roundtable-as-thesis, surfaced the
"innovate beyond human meeting limits" angle, and flagged the rubric/scope tradeoffs that
produced the thin-slice scope.

## Consequences

- **spec 050 (group chat) must be updated**: promote side-conversation from a collapsed
  chip to a first-class **breakout room** surface — observe + enter + interject + report
  back; define enter/leave semantics.
- **UI**: the chat shell (#9) is reframed as the *main table*; a new `BreakoutRoom`
  component is added; issue #17 (side-conversation observability) becomes the
  breakout-room ticket. The batch-1 design handoff (`docs/ui-handoff-batch1.md`) stays
  valid; a breakout component joins a later batch.
- **Demo**: the opener becomes a roundtable entrance; the field-rename conflict (#31,
  orchestrator-owned by Evanlin) becomes the breakout demo beat — needs coordination so
  the orchestrator emits the side-conversation/conflict events the breakout renders.
- **Deferred (logged, not silent):** the ambient office presence layer, parallel
  multi-breakout, and animation. Content surfaces (diff/handoff/preview) remain cards.
