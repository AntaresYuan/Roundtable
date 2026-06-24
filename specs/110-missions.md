# Spec 110: Missions — The Primary Execution Unit

> **Status: DRAFT for review.** Created from the v0.2 product roadmap in GitHub
> issue #155 and the first next-step implementation issue #147. This spec defines
> the product boundary between `Mission`, `Workflow`, chat, and runtime state.

## 1. Why Mission exists

Roundtable should not be centered on a raw chat room. A chat is a useful interface,
but it is not the product object the user is trying to complete. The user is trying
to finish a bounded engineering goal: add a feature, fix a bug, understand a repo,
review a PR, or produce a delivery report.

A **Mission** is one execution of a workflow for one concrete user goal.

Mission gives Roundtable a durable unit for:

- goal and scope;
- workflow template selected for the goal;
- current stage and task state;
- agent assignments;
- human checkpoints and decisions;
- hand-off chain;
- artifacts and dependencies;
- final delivery status.

This makes Roundtable feel like an AI workflow collaboration platform rather than a
multi-agent chat transcript.

## 2. Product nouns

| Noun | Meaning | User-facing role |
| --- | --- | --- |
| `Workflow` | A reusable expert method. | "Use Feature Builder." |
| `Mission` | One execution of a workflow for a goal. | "Add team invitations." |
| `Chat` | A conversational surface attached to a mission. | Where the user speaks. |
| `WorkflowRun` | Observed runtime projection of the current workflow execution. | Powers progress UI. |
| `HandoffCard` | Minimum sufficient context package passed between agents. | User-inspectable transfer. |
| `Artifact` | Durable output from a task. | What the mission produced. |
| `Checkpoint` | A required decision before progressing. | Where the user or reviewer intervenes. |

## 3. Mission vs Workflow vs Chat vs Run

### Workflow

`Workflow` remains the reusable, editable expert process from spec 090. It answers:

- Which stages exist?
- Which roles participate?
- Which gates are enforced?
- What instructions shape each stage?

It is reusable and can be forked.

### Mission

`Mission` answers:

- What is this user trying to accomplish?
- Which workflow is being executed?
- Where are we now?
- Which tasks, handoffs, artifacts, checkpoints, and decisions exist?
- Is the final delivery ready to accept?

It is not a template. It is a concrete execution record.

### Chat

Chat is the interaction surface. Multiple messages can belong to the same mission.
The same mission may later be surfaced in other views: timeline, artifact gallery,
dependency graph, final report, or reviewer panel.

Chat must not be the only source of truth for progress.

### WorkflowRun

`WorkflowRun` stays as the read-only runtime projection used by the current UI. It is
the compatibility bridge for v0.2: existing workflow-run state can be projected into
a `Mission` without rewriting the live dispatch path first.

Long term, the Mission API should become the UI's primary read object, with
`WorkflowRun` either embedded or derived.

## 4. Minimal contract

The initial contract is intentionally conservative:

- `Mission.id`
- `Mission.goal`
- `Mission.status`
- optional `chatId` / `workbenchId`
- `workflow` reference: template id, version, name, origin kind
- `activeStageId`
- `stages`
- `tasks`
- `checkpoints`
- `decisions`
- `artifactIds`
- `handoffCardIds`
- `finalDelivery`
- timestamps

The first implementation also includes a pure projection helper:

```ts
missionFromWorkflowRun({
  id,
  goal,
  chatId,
  workflow,
  workflowRun,
  plan,
})
```

This lets the existing live path be represented as a Mission before the database and
UI are fully migrated. The read path that calls this projection over live turn
history is `loadMissionForChat` (see §7 step 2).

## 5. Mission status

| Status | Meaning |
| --- | --- |
| `draft` | Mission exists but does not yet have a plan. |
| `planned` | A workflow/plan exists, but agents have not started meaningful execution. |
| `running` | At least one stage or task is actively executing. |
| `blocked` | A gate, recovery card, or required user/reviewer action blocks progress. |
| `completed` | All stages are done and final delivery can be generated or accepted. |
| `failed` | Execution failed without a current recovery path. |
| `canceled` | User or system canceled the mission. |

## 6. Checkpoints and decisions

Checkpoints are product-visible control points. They make workflow quality gates
concrete for novice users.

Initial checkpoint kinds:

- `clarification`
- `plan_approval`
- `user_approval`
- `handoff_acceptance`
- `reviewer_signoff`
- `test_repair`
- `final_acceptance`
- `custom`

Decisions are append-only records such as approve, request changes, reject, pause,
resume, reassign, request tests, or accept delivery.

## 7. Compatibility plan

### Step 1: Contract and projection

Add the `Mission` contract and `missionFromWorkflowRun` helper. No database migration
is required in this step.

### Step 2: Read API *(implemented)*

Expose Mission-shaped data from live turn history by projecting existing
`workflow + workflowRun + plan` values. This keeps the UI compatible with current
turn storage.

This ships as `loadMissionForChat` in `src/server/mission-query.ts` (with the pure
`missionFromTurn` / `latestMissionTurn` helpers) served over
`GET /api/orchestrator/mission?chatId=…`, mirroring the existing
`/api/orchestrator/history` route. It picks the newest turn that actually drove a
workflow run and returns `mission: null` for chats with no run yet. No database
migration is required.

### Step 3: Persistence

Once the UI consumes Mission as the primary object, add first-class persistence for
missions, mission tasks, checkpoints, decisions, and final delivery records.

### Step 4: Mission-first UI

Move the entry point from "start a chat" to "start a mission from a workflow
template." Chat remains inside the mission.

## 8. Non-goals for this spec

- Do not replace the current live dispatch path in the first step.
- Do not build arbitrary node-canvas workflow editing.
- Do not require full A2A compliance.
- Do not pass full chat history to downstream agents as a shortcut.
- Do not create a database migration until the Mission API shape is stable.

## 9. Open questions

- Should one chat have exactly one active mission, or can a chat host multiple
  missions over time?
- Should final delivery be a generated artifact, a Mission field, or both?
- Should rejected checkpoints create a new task immediately or first ask the PM to
  propose a repair plan?
- Which mission events need append-only audit storage before v0.2 ships?
