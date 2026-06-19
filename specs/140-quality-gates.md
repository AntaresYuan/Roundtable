# Spec 140: Quality Gates & Human Intervention

> **Status: DRAFT for review.** Created from the v0.2 roadmap (#155) and next-step
> issue #150. Builds on spec 090 (Workflows / `Gate`), spec 110 (Missions /
> checkpoints & decisions), and spec 130 (Workflow templates).

## 1. Why gates

A strong AI product is not fully automatic everywhere. It must know when to ask the
user for approval, clarification, rejection, or recovery. Gates are what turn agent
execution into a controllable product instead of an opaque background process, so
novices can safely delegate complex work.

## 2. Gate kinds

The editable `Gate` (spec 090) gains richer kinds so a stage can declare exactly
what human intervention it requires:

| Gate kind | Maps to checkpoint | Meaning |
| --- | --- | --- |
| `none` | — | no intervention |
| `clarification` | `clarification` | answer a question before proceeding |
| `plan_approval` | `plan_approval` | approve the plan (or ask for smaller tasks) |
| `api_contract_approval` | `user_approval` | approve a proposed API contract |
| `user_approval` | `user_approval` | generic approve-to-continue |
| `handoff_acceptance` | `handoff_acceptance` | accept/reject a handoff |
| `test_repair` | `test_repair` | tests failed — request repair/tests |
| `reviewer_signoff` | `reviewer_signoff` | a reviewer must sign off |
| `final_acceptance` | `final_acceptance` | accept the final delivery |

Each gate may carry a `prompt` overriding the default explanation.

## 3. User actions

Gate actions reuse `MissionDecisionAction` (spec 110): `approve`,
`request_changes`, `reject`, `pause`, `resume`, `reassign`, `request_tests`,
`accept_delivery`. Each gate kind declares its allowed subset (`GATE_POLICY`).

## 4. Policy & enforcement

`src/contracts/gate-policy.ts` is the single, pure source of truth:

- `checkpointKindForGate(gate)` / `allowedGateActions(gate)` / `explainGate(gate)`.
- `canAdvancePastGate(decisions)` — a gate blocks until an **advancing** decision
  (`approve` or `accept_delivery`) is recorded. This is what the orchestrator
  consults before dispatching the next stage.
- `followUpTaskForRejection(task)` — a rejected or failed handoff yields a **new
  pending** task that depends on the original; the original (often already
  `completed`) is never mutated, preserving the audit trail (#150, #153).

The Mission projection (`missionFromWorkflowRun`, spec 110) now maps each gated
stage to a checkpoint of the correct kind and attaches the explanation, so a
**blocked Mission clearly says what input it needs**.

Autonomy: `riskForGate` treats `user_approval`, `plan_approval`,
`api_contract_approval`, and `final_acceptance` as high-risk (always surfaced).

## 5. Acceptance criteria (#150)

- [x] Workflow stages can declare required gates — extended `GateSchema`.
- [x] The orchestrator respects gate state before dispatching — `canAdvancePastGate`
  + existing gate-pause node; gated stages block in `WorkflowRun`/Mission.
- [x] Actions include approve, reject, request tests, pause, resume — `GATE_POLICY`.
- [x] A blocked Mission explains the required input — checkpoint `reason`/`explainGate`.

## 6. Non-goals

- No new LangGraph gate nodes per kind yet — the existing pause/interrupt node
  blocks on `pendingGate` regardless of kind; per-kind resume UX is #151.
- No DB persistence of decisions yet (spec 110 step 3).

## 7. Open questions

- Should `pause`/`resume` be gate decisions or Mission-level controls independent of
  any single gate?
- Should `request_tests` auto-create a `test_repair` follow-up task?
