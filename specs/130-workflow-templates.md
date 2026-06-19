# Spec 130: Workflow Templates

> **Status: DRAFT for review.** Created from the v0.2 roadmap (#155) and next-step
> issue #148. Builds on spec 090 (Workflows), spec 110 (Missions), and spec 120
> (HandoffCard V2).

## 1. Why templates

Roundtable should help non-experts complete complex software tasks by giving them
**expert workflow templates**, not by asking them to design a workflow. A
`Workflow` (spec 090) is the reusable, editable expert method; a `WorkflowTemplate`
packages one with the novice-facing layer needed to launch a Mission safely.

The advanced workflow editor stays, but preset templates become the primary entry
point (#151).

## 2. What a template adds over a Workflow

A template **wraps** an executable `Workflow` (unchanged — the orchestrator still
drives it) and adds:

| Field | Purpose |
| --- | --- |
| `summary`, `bestFor`, `expectedOutput` | product copy: what it does, when to use it, what you get. |
| `flagship` | marks the headline path (Feature Builder). |
| `requiredInputs[]` | the minimum inputs the launch flow collects (id, label, help, required). |
| `stageGuides[]` | per-stage plain-language `intent` plus `expectedHandoffInputs` / `expectedHandoffOutputs`. |

**Invariant (enforced by schema):** every workflow stage has exactly one stage
guide, and no guide references a missing stage. A template with an unexplained
stage is not novice-safe.

## 3. Built-in templates

Defined as typed, schema-validated data in `src/contracts/workflow-template.ts`
(not UI fixtures), so UI, server, and orchestrator share one source of truth.

| Template | Path | Stages |
| --- | --- | --- |
| **Feature Builder** *(flagship)* | vague request → reviewed feature | clarify → plan → split → implement → review → repair → deliver |
| **Bug Fixer** | bug report → verified fix | report → diagnose → fix → verify |
| **Codebase Onboarding** | unfamiliar repo → map + starter tasks | scope → explore → map → starter-tasks |

Gates use the spec-090 `Gate` kinds (`user_approval`, `reviewer_signoff`); the
richer checkpoint set lands with quality gates (#150). Feature Builder gates plan
approval, reviewer sign-off, and final delivery.

## 4. Stage handoff contract

Each stage guide names the HandoffCard inputs it expects and the outputs it
produces, e.g. Feature Builder `plan` consumes `clarified goal` + `acceptance
criteria` and produces a `technical plan`. This is the human-readable contract
that HandoffCard V2 (spec 120) carries between agents.

## 5. Starting a Mission from a template

The launch flow (#151) collects `requiredInputs`, then the embedded `workflow`
drives a `WorkflowRun`, which projects into a `Mission` via
`missionFromWorkflowRun` (spec 110). No new persistence is introduced here.

## 6. Non-goals

- No arbitrary workflow editing UX (the advanced editor already exists).
- No DB seeding change in this spec — templates are typed data; persisting them as
  `workflows` rows can follow.
- No orchestrator changes to consume `stageGuides` yet; this spec defines the
  template contract and the three built-ins.

## 7. Open questions

- Should built-in templates also be seeded as `workflows` rows (like the current
  SQL built-in), or resolved from code at launch time?
- Should `requiredInputs` map to intake clarification questions automatically?
