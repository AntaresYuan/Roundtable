# Spec 150: Mission Launch & Checkpoint UX

> **Status: DRAFT for review.** Created from the v0.2 roadmap (#155) and next-step
> issue #151. Builds on spec 110 (Missions), 130 (Workflow templates), and 140
> (Quality gates). This is the first novice-facing UI for the Mission flow.

## 1. Why

The primary user flow should start with *what the user wants to accomplish*, then
run an expert workflow for them. A novice should not need to understand agents,
schemas, or the workflow editor before getting value.

## 2. Entry point

A dedicated route `/mission` (`src/app/mission/page.tsx` →
`src/ui/components/mission-launch.jsx`). It is self-contained and does not touch
the existing chat app (`app-root.jsx`), so the Mission flow can mature
independently.

## 3. Launch flow

1. **Choose a template.** Lists `BUILTIN_WORKFLOW_TEMPLATES`; the flagship
   (Feature Builder) is marked *Recommended*.
2. **Give the minimum inputs.** Renders the template's `requiredInputs` (goal +
   optional context / constraints / desired output). Only the goal is required.
3. **Start.** POSTs to `/api/orchestrator/turn` with `{ message, chatId,
   workflowTemplateId }`. The new `workflowTemplateId` param drives the turn from
   the template's workflow directly — no workbench binding — so the run projects
   into a real Mission immediately (spec 110).

## 4. Running view

Polls `GET /api/orchestrator/mission?chatId=…` and renders:

- the goal and Mission status (plain-language badge);
- **Needs your decision** — checkpoints awaiting the user, each with its
  explanation (`explainGate`, spec 140), kept **separate** from status;
- **Progress** — stages with status and, when "Explain simply" is on, the
  template `stageGuide.intent` for each stage.

Novice controls: *Explain simply* (toggle stage explanations), *Pause/Resume
updates* (polling), *Refresh*, and *Approve & continue* on a decision (POSTs to
`/api/orchestrator/approval`).

## 5. Acceptance criteria (#151)

- [x] Start a Feature Builder Mission without the advanced workflow editor.
- [x] Current stage and checkpoint visible in plain language.
- [x] Required decisions are separated from agent status updates.
- [x] The launch flow creates a real Mission record (template-driven turn).

## 6. Non-goals

- No change to the existing chat app entry point yet.
- Full handling of every novice action (make tasks smaller, add tests, reassign)
  beyond approve/continue — those map to `MissionDecisionAction` and follow as the
  decision pipeline (spec 140) is wired end-to-end.
- No live dispatch auto-run; the Mission is created and inspectable, and advances
  on approval.

## 7. Open questions

- Should `/mission` become the default app entry, with chat nested inside?
- Should the running view stream (SSE) instead of polling?
