# ADR-009: Workflows are configured spec objects, not a drawn canvas

## Status

Accepted (2026-06-01)

## Context

The customizable **Workflow** feature is a declared core differentiator ("packaged,
visualizable, customizable workflows that raise vibecode output quality — beginners start
from a polished one, power users build their own"). But three places forbid the obvious
implementation: PRD §5, spec 000 non-goals, and ADR-008 all say coordination comes from
**chat + Orchestrator, not a canvas** (the moat versus Coze).

The current code also has concrete debt that forced a model decision: two disjoint shapes
(`TEMPLATES` carries `roles`/`pipe` in `modals.jsx`; `WORKFLOW.stages` carries `who` in
`rt.js`), a lossy `saveTemplate`, an inert `+ step`, and a broken round-trip where
`NewWorkbenchModal.onCreate({name, tpl})` discards the chosen workflow. See
`specs/090-workflows.md` for the full design.

## Decision

1. **One editable `Workflow` object + a separate read-only `WorkflowRun`.** The spec is
   what the user edits; the run is observed runtime state. The gallery card is a
   *projection* of the `Workflow`, never a stored second shape.
2. **Gates actually pause the run.** A gated stage transitions `active → blocked` and
   waits for a `gate.resolve` event (rendered as an inline `GateCard`). Quality enforcement
   is real, not decorative.
3. **Customization configures conversational/role objects, never draws a DAG.** The only
   "customize" surfaces are: who's at the table (roster + adapter), each role's
   prompt/skills/tools, the HandoffCard before dispatch, and gate/parallel toggles on a
   stage. Task decomposition, parallelism, and dependencies are **inferred by the
   Orchestrator at runtime** and rendered read-only — the user never authors an edge.
4. **The "eject hatch" is a read-only definition view + a diff toast, not editable YAML
   authoring** (that would re-introduce author-time wiring; deferred).

## Why

- **It's the moat.** A node-graph canvas is exactly what Coze/Make are and what the PRD
  rejects; chat-first + configured objects is the differentiator.
- **Spec-vs-run split** is what lets the live `WorkflowStrip` read truth (real stage
  states) without contaminating the editable object — and it maps onto the golden-path
  (spec 080) M1–M5 gaps and specs 010/030/060.
- **One object** kills the two-model round-trip bug at the root.

## Alternatives considered

- **Node-graph canvas (Coze-style).** Rejected — directly violates the stated non-goal.
- **Editable YAML authoring with round-trip.** Deferred — re-introduces author-time
  wiring and is a power-user-only surface that doesn't move the demo; v1 ships read-only
  "View definition" + diff.
- **One object mixing spec + runtime state.** Rejected — the strip could not show live
  truth without mutating the user's editable workflow.

## AI assistance

The design emerged from a 2026-06-01 multi-agent design workflow (8 subagents: parallel
code-audit + intent-extraction + competitive-pattern survey → three lensed proposals
(beginner-first / power-user-first / quality-outcome-first) → a scored judge panel →
synthesis). The judge scored quality-outcome-first highest (23/25) and the synthesis took
its spec-vs-run spine, beginner-first's shippable build order, and power-user-first's
contract rigor (discriminated `Gate` union, `parallelGroup`, role-token `SeatRef`). Full
record: `specs/090-workflows.md`.

## Consequences

- New contracts `src/contracts/workflow.ts` + `workflow-run.ts` (zod, discriminated
  unions) — these live in the contracts layer (Evanlin's area; hand off via this doc).
- `WorkflowView` reads/writes a persisted `Workflow` (localStorage v1, tRPC v2); delete
  `TEMPLATES`/`PIPE_DEFAULT`/`pipe`/`roles`/`currentStageIndex`.
- Orchestrator dispatch binds `seats` (role→adapter), folds `brief`/`skills` into the
  HandoffCard (closes golden-path gap 1), expands `parallelGroup` to real fan-out (gap 6),
  and blocks on gates — orchestrator work (Evanlin's area).
- A new runtime `GateCard` surface and a validation pass enforced on Save and at dispatch.
