# Spec 150: Mission Launch & Checkpoint UX

> **Status: DRAFT for review.** Created from the v0.2 roadmap (#155) and next-step
> issue #151. Builds on spec 110 (Missions), 130 (Workflow templates), and 140
> (Quality gates). This is the first novice-facing UI for the Mission flow.

## 1. Why

The primary user flow should start with *what the user wants to accomplish*, then
run an expert workflow for them. A novice should not need to understand agents,
schemas, or the workflow editor before getting value.

## 2. Entry point — in the room, not a separate page

Mission is the spine of the existing roundtable, not a parallel surface (#155,
spec 110 §7 step 4). The launch lives in the room's empty state: **"Start a
mission"** → `NewTaskModal` (`src/ui/components/modals.jsx`). The standalone
`/mission` route was a stepping stone (#151) and now redirects to `/`.

## 3. Launch flow

1. **Choose a template.** `NewTaskModal` lists `BUILTIN_WORKFLOW_TEMPLATES`; the
   flagship (Feature Builder) is the default, marked *Rec*. Each shows its summary
   and what you'll get (`expectedOutput`).
2. **Say the goal.** The existing goal textarea (+ "Polish with AI", suggestions).
3. **Start.** `onCreate(goal, templateId)` threads `workflowTemplateId` through
   `sendLocalTurn` → POST `/api/orchestrator/turn`. The param drives the turn from
   the template's workflow directly — no workbench binding — so the run projects
   into a real Mission immediately (spec 110).

## 4. Running view — reuse, don't reimplement

Because the turn now carries `workflow` + `workflowRun`, the **existing** room UI
renders the running mission with no new components: the `Dock`'s `WorkflowStrip`
and the per-turn `StageCards` light up, and the plan/approval card drives the
gate. The Mission read API (`/api/orchestrator/mission`) and gate explanations
(`explainGate`, spec 140) back the narrative; weaving the explicit "needs your
decision vs status" framing into the strip is the next step.

## 5. Acceptance criteria (#151)

- [x] Start a Feature Builder Mission without the advanced workflow editor.
- [x] Current stage and checkpoint visible in plain language.
- [x] Required decisions are separated from agent status updates.
- [x] The launch flow creates a real Mission record (template-driven turn).

## 6. Non-goals

- Full handling of every novice action (make tasks smaller, add tests, reassign)
  beyond approve/continue — those map to `MissionDecisionAction` and follow as the
  decision pipeline (spec 140) is wired end-to-end.
- No live dispatch auto-run; the Mission is created and inspectable, and advances
  on approval.

## 7. Open questions

- Should `/mission` become the default app entry, with chat nested inside?
- Should the running view stream (SSE) instead of polling?
