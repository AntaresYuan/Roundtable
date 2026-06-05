# Spec 090: Workflows — The Packaged, Customizable Collaboration Loop

> **Status: DRAFT for review.** Normalizes "workflow" as a first-class object. The
> intent was previously spread across specs 010 (the loop), 030 (hand-off), 060
> (deps), 070 (skills), 080 (golden path) and ADR-007/008. This spec owns the
> `Workflow` / `WorkflowRun` contracts and the customization surface. A companion
> ADR (`ai-logs/decisions/ADR-009-workflow-as-spec-not-canvas.md`) records the
> load-bearing decision: **customization configures conversational objects; gates
> actually pause the run; we never ship a node-graph canvas.**

## 1. Goal & the two audiences

A **Workflow** in Roundtable is not a diagram of nodes. It is a named, reusable
configuration of the Orchestrator's 7-stage role loop (spec 010): *which role-agents
are seated, what each is told, which review/approval gates are enforced, and how
hand-offs are shaped*. "Packaging a workflow" = packaging that configuration so it
ships as a runnable starter and can be re-cast, re-instructed, and re-gated.

The owner's mandate (2026-05-24 consensus): *"封装好的工作流可视化，可自定义，目的是提升整体 vibecode 作品水平 — 帮助小白从开始就上手完善工作流，帮助重度使用者搭建自己的工作流。"* Two doors over one engine:

- **Beginner** (non-code founder, designer/operator, student): picks an opinionated,
  already-working workflow and ships in one sentence. Never reads terminal output,
  never sees a role, never makes a stage decision. Quality discipline (review gate,
  dependency awareness) is **on by default and invisible** until it needs a tap.
- **Power user** (experienced vibe coder): re-seats roles, binds their own CLI to a
  role, edits per-role instructions/skills, edits the hand-off, sets gates — and saves
  / forks / shares the result. Customization is bounded to **configuring the meeting**,
  never drawing a graph.

**North star:** *Chat is the linear path everyone gets for free; the Workflow spec is
the eject hatch power users earn by tapping deeper — and it's the same object the whole
way down.*

## 2. The non-negotiable boundary — customizable but NOT a node-graph canvas

Stated in three independent places (PRD §5 out-of-scope, spec 000 non-goals, ADR-008):
coordination comes from chat + Orchestrator, **not a canvas**. This is the moat versus
Coze. The concrete rule:

> **Customization happens by configuring conversational/role objects, never by wiring a
> DAG on a canvas.** The only permitted "customize my workflow" surfaces are:
> editing **who is at the table** (roster + adapter binding), editing **each role's
> prompt + skills + tools**, editing the **HandoffCard** before dispatch, and toggling
> **gate / parallel** on a stage. Task decomposition, parallelism, and dependencies are
> **inferred by the Orchestrator at runtime** and rendered read-only/observed — the user
> never authors an edge.

Enforcement of the rule in this design:

- No draggable nodes, no edge-drawing affordance, no x/y coordinates, no pan/zoom.
- The dependency graph (spec 060) is the one *rendered* graph and stays **read-only**:
  it visualizes what agents declared at runtime; crossing into user-drawn edges is the
  rejected line.
- Stage order is the only "edge," and it is implicit/sequential, reordered with
  chevrons — never a connector.
- Per ADR-007: the PM may *suggest* a new stage/agent (Quick Action) but cannot
  instantiate without user confirmation. Save / Fork are always user-driven.
- The "eject hatch" is a **read-only** definition view + a one-line diff toast, not an
  editable YAML authoring path (that would re-introduce author-time wiring and is
  deferred — see §9).

## 3. Surfaces

Three editable surfaces over ONE editable `Workflow`, plus one runtime card. None is a
canvas.

### S1 — `WorkflowStrip` (Roundtable scene, live read-only spine)
Stays at the top of the Roundtable page. **Becomes data-driven, not clock-driven.**
Reads the live `WorkflowRun.stageStates` and lights each stage `pending | active |
blocked | done | failed`. This is the "transcript IS the workflow" spine — progress reads
as a story, left-to-right.
- A `blocked` stage (open gate) pulses amber with an inline `[Approve ▸]`; tapping it
  scrolls the transcript to the `GateCard`. This is the only place a gate becomes visible
  to a beginner, and it is one tap.
- A parallel group renders as a **single widened pill with stacked owner-color avatars
  that fan back to one** — parallelism as a temporary widening of one timeline, never a
  branch. This is the explicit anti-canvas move for the one thing canvases sell.

### S2 — `WorkflowView` (Workflow tab, the editor + eject ladder)
Stays a horizontal rail of `StageCard`s, but now **reads and writes the persisted
`Workflow`** for the current workbench (edits survive refresh — the single biggest
correctness fix). Adds:
- A **quality-rail header** replacing the cosmetic banner: always-visible chips
  `Review gate: on` · `Dependency-sync: on` · `Plan: by role`. Quality is the spec's
  visible identity, not a buried per-card toggle.
- Per stage (rung 1, always visible): rename, edit desc, reorder, add/remove, delete
  (non-fixed), and the `parallel` / `gate` controls — now real (§7).
- Per stage (rung 2, "Customize" → `StageDrawer`, S3).
- A **"View definition"** toggle: flips the rail to a **read-only** human-readable YAML
  view of the `Workflow` (GitHub-Actions mental model) for inspect / copy / share. On any
  structural edit, a one-line **diff toast** ("Review gate added to *Ship*") shows what
  changed. Editing stays structured in the cards — YAML is not author-time-editable in v1.
- Header actions: `Start from template`, `Save` (writes back), `Save as my workflow`
  (lossless), `Fork`, `Reset to template`.

### S3 — `StageDrawer` (slide-over from a StageCard — the per-stage deep editor)
Replaces the fake global `onAddAgent`. A right slide-over within the tab (not a modal):
- **Who runs it** — a real **stage-scoped `RolePicker`** with tabs:
  `[Add role | Pick existing member | + You]`. Choosing a role lets you bind an adapter
  and optionally a concrete workbench member. Fixes the audit's "add-agent is fake" and
  the inability to add `'user'`.
- **Instructions** — a textarea: the per-seat prompt addendum → flows into
  `HandoffCard.taskBrief` at dispatch.
- **Skills** — multiselect of built-in `skills/runtime/*` ids (spec 070; built-in only
  in v1).
- **Gate** — radio over the `Gate` union: `none` / `requires my approval` /
  `requires reviewer sign-off`.
- **Parallel** — `parallel-with-next` toggle (joins adjacent stages into a fan-out band).
- **Hand-off preview** — read-only render of the `HandoffCard` this stage passes
  downstream, with `[✎ Edit]` (reuses spec 030).

### S4 — `NewWorkbenchModal` (beginner front door, in `modals.jsx`)
Same modal, real semantics. Gallery cards carry **full `Workflow` objects** (built-in +
user), not the lossy `pipe`/`roles` projection. "Create" **forks a runnable, editable
instance** onto the workbench (fixes the broken round-trip). The golden-path workflow is
pre-selected and tagged **"Most used · just works"** — a beginner can hit Create with zero
further choices. The inert `+ step` button is **removed**; "Build your own" forks the
opinionated default, never an empty table. Forks show provenance ("forked from
Full-stack Squad").

### S5 — `GateCard` (runtime, inline in the transcript — the quality payoff)
When a gated stage finishes, the run does **not** advance. A `GateCard` renders inline:
the artifacts produced, the reviewer's anchored comments, and
`[Approve & continue]` / `[Request changes]` / `[✎ Edit hand-off]`. This is the
mandatory-review-pass made physical and realizes golden-path beats 7–8.

### S6 — Workflow recommendation banner (advisory, non-editable)
Because every task carries a description, the active workflow may not be the best fit. When a
task is selected, a dismissible banner surfaces a better-fit suggestion: *"✨ This task fits
**X** better — &lt;reason&gt;"* with `[Use it]` (switches the workbench's `workflowId`) and `✕`.
The reason renders **inline, not on hover** (owner preference). Two-tier: the server query
`ai.recommendWorkflow({ task, workflows })` (`src/server/routers/ai.ts`) asks the PM model —
火山引擎 via `defaultOrchestratorModel()`, NOT Anthropic — for `{ workflowId, reason }`,
validates `workflowId ∈ input` (else returns `null`); a local keyword heuristic is the offline
fallback. This is advisory only: it never edits a `Workflow`, only proposes switching which one
the workbench runs, so it stays outside the anti-canvas boundary (§2).

### Deliberately NOT built
Node canvas, edge-drawing, beginner/advanced mode-select at the door, empty-canvas custom
template, editable-YAML authoring, and an always-on command palette (fast-follow, §9).
The dependency mini-graph (spec 060) stays a read-only stretch; v1 ships the dependency
*badge* only.

## 4. Data model — ONE editable spec + a separate runtime object

Collapse the two disjoint models (`TEMPLATES`'s `roles`/`pipe` and `WORKFLOW`'s `who`)
into one `Workflow`. The gallery card is a **projection** of it, never a stored second
shape — this kills the hardcoded `roles: ['planner','implementer','reviewer']` lie and
makes the round-trip total. The editable spec and the runtime state are **separate
objects**: the spec is what the user edits; the run is read-only observed state. This
separation is what lets the strip read truth without contaminating the editable object.

Lives in `src/contracts/workflow.ts` as zod (no `any`, discriminated unions per
CLAUDE.md), mirrored into `rt.js` fixtures.

```ts
// src/contracts/workflow.ts
export type RoleId = 'architect' | 'planner' | 'implementer' | 'reviewer' | 'fixer';
export type AdapterId = 'claude-code' | 'opencode' | 'codex' | 'custom';

// Role-first ref: built-in templates use role tokens (castable onto any workbench);
// a workbench-bound workflow resolves them to concrete agentIds.
export type SeatRef =
  | { kind: 'user' }
  | { kind: 'role'; role: RoleId; agentId?: string };

export interface Seat {
  ref: SeatRef;
  adapter?: AdapterId;        // override; else the role default (spec 010 role→adapter)
  brief?: string;            // per-seat instruction → HandoffCard.taskBrief
  skills?: string[];         // mounted skills/runtime/* ids (spec 070; built-in only v1)
  tools?: string[];          // MCP tool ids (Custom agents)
}

// Discriminated union — replaces the decorative boolean; carries enforcement (§7).
export type Gate =
  | { kind: 'none' }
  | { kind: 'user_approval' }                              // pauses; user clicks continue
  | { kind: 'reviewer_signoff'; reviewer: SeatRef;         // a @reviewer must pass
      blockOn: 'open_comments' };

export interface Stage {
  id: string;                // stable; survives rename/reorder
  name: string;
  icon: string;              // pickable (fixes the fixed-'dot' gap)
  desc: string;              // beginner-facing one-liner; card + strip tooltip
  kind: 'intake' | 'plan' | 'work' | 'review' | 'ship' | 'custom'; // bridge to spec-010 loop
  seats: Seat[];             // replaces who: string[]
  parallelGroup?: string;    // adjacent stages sharing a groupId fan out together
  gate: Gate;                // default { kind: 'none' }
  fixed?: boolean;           // intake only: locked roster/flags
  handoffOverride?: Partial<HandoffCard>; // user edits to carried context (spec 030)
}

export interface Workflow {
  id: string;
  name: string;              // outcome-named ("Ship a PR-ready feature")
  tag?: string;              // 'Most used · just works' | 'Yours' | ...
  desc: string;
  origin: { kind: 'builtin' | 'user' | 'fork'; from?: string }; // provenance; replaces string-match banner
  builtin?: boolean;         // platform starter (read-only; Fork to edit)
  planning: {
    cut: 'by_role';          // never by_file (spec 010); fixed in v1
    clarifyThreshold: number; // 0..1, default 0.6 (spec 010 Clarify)
    maxClarifyQuestions: number; // default 3
  };
  stages: Stage[];
  version: number;           // bumped on save; drives the diff toast
  updatedAt: string;
}
```

```ts
// src/contracts/workflow-run.ts — read-only observed state; the user NEVER edits this.
export interface WorkflowRun {
  specId: string;
  specVersion: number;
  stageStates: Record<string /* stageId */, {
    status: 'pending' | 'active' | 'blocked' | 'done' | 'failed';
    seatRuns: { agentId: string; status: string; artifactIds: string[] }[];
    gate?: { open: boolean; reason?: string; comments?: ReviewComment[] };
  }>;
  activeStageId?: string;
  pendingGate?: { stageId: string; gate: Gate };
  depEdges: { from: string; to: string; stale: boolean }[]; // emergent, agent-declared (spec 060)
}
```

Key consequences:
- `seats` is the **single source** for "who runs it": gallery avatars, editor chips,
  strip active-stage detection, and dispatch all read it. `pipe` and `roles` are deleted.
- The gallery card is computed: `stages.map(s => ({ icon: s.icon, label: s.name }))` plus
  role avatars derived from `seats`. A view, not a stored model.
- `kind` ties each visual stage to a spec-010 loop phase without exposing the state
  machine to beginners.
- **Persistence (v1, localStorage matching the current approach):** `rt.workflows`
  (built-ins + user `Workflow`s), `rt.workbench.<id>.workflowId` (which workflow a
  workbench runs), `rt.activeWorkflow` (the editor's working copy). Built-ins live in code
  as `BUILTIN_WORKFLOWS` (`builtin: true`, edited only via Fork). v2 = tRPC.

## 5. Beginner path (step by step) — polished workflow in <30s, zero config

1. New Workbench → modal opens with **"Ship a PR-ready feature"** pre-selected, tagged
   "Most used · just works". Card preview shows the linear stages + a `Review gate on`
   chip (the selling point a beginner can see).
2. Type a name, click **Create**. `onCreate({ name, workflow })` deep-clones the built-in
   `Workflow` onto the new workbench (`workflowId` + a fresh instance, `origin:
   { kind:'fork', from:'fullstack' }`). **No stage decisions made.**
3. New Task → type one sentence → Start. The workbench runs its `Workflow`. The strip
   lights stages from real `WorkflowRun.stageStates`. Review + dependency discipline are
   **on by default and invisible**.
4. At the Review gate, the run pauses; the strip shows an amber `[Approve ▸]` and a
   `GateCard` appears inline with the artifacts + reviewer comments. One tap (`Approve &
   continue`) advances to Ship. The beginner never opened the Workflow tab, never saw a
   role, and still got a reviewed result.

## 6. Power-user path (step by step) — build their own

**A. Reshape a stage.**
1. Workflow tab → click a stage's **Customize** → `StageDrawer` slides in.
2. **Who runs it** → `RolePicker`: remove the `@implementer` placeholder, add concrete
   members `Atlas` + `Beam`; set each seat's adapter ("Claude Code / OpenCode / Codex /
   Custom"); or `+ You`; or "Suggest a new agent" (ADR-007 confirm flow).
3. Edit **Instructions** ("prefer server components, no client JS for submit"); mount the
   `write-orchestrator-prompt` skill.
4. Toggle `parallel-with-next` on Build so Build + Test fan out; set Review's gate to
   `requires reviewer sign-off → Vera`. A diff toast confirms each change.
5. Close drawer → header shows **unsaved changes** → **Save** writes back to
   `rt.workflows` + bumps `version`. Edits persist (the core bug fixed).

**B. Eject to definition (read-only).**
1. Workflow tab → **View definition** → YAML of the `Workflow` (inspect / copy / share).
2. Structural edits made in the cards are reflected here and as diff toasts. Editable-YAML
   authoring is deferred (§9); the round-trip guarantee is that the YAML and the cards are
   the *same object* serialized.

**C. Save / Fork / Share loop.**
- **Save as my workflow** → snapshots the whole `Workflow` losslessly into `rt.workflows`
  (`origin: { kind:'user' }`, `tag:'Yours'`); appears in the gallery AND **loads back into
  the editor** (round-trip — today broken).
- **Fork** any built-in/shared workflow → new id, `origin: { kind:'fork', from }`.
- **Share** (v1) → copy/export the definition; team/community gallery is post-v1 (PRD §5).

## 7. How a workflow drives a REAL run (orchestrator + roundtable binding)

Today the scene is fully scripted (`RT.SCRIPT` / `PLAN_TIMELINE`) and the strip guesses
the stage via `currentStageIndex(clock)` magic numbers — the workflow drives nothing. The
binding makes the `Workflow` the **input to the orchestrator loop** and `WorkflowRun` the
**input to the UI**, closing both broken directions. The Orchestrator still *infers*
decomposition/parallelism/deps at runtime (spec 060 emergent graph); the workflow supplies
the **cast, gates, and per-role instructions**, not author-time wiring.

**Workflow → orchestrator (authoring side):**
- `seats[].ref / adapter` → the cast seated + dispatch targets and the role→adapter
  binding for each stage. Role tokens resolve to concrete agentIds on the bound workbench.
- `seats[].brief / skills / tools` → folded into each agent's `HandoffCard.taskBrief` +
  system prompt + mounted skills at dispatch. **This closes golden-path gap 1** (user
  intent/brief reaching the implementer).
- `parallelGroup` → seats/tasks in the group dispatched **concurrently**, fanning in
  before the next stage. **Closes golden-path gap 6** (`dispatch.ts` currently `for`-awaits
  serially).
- `kind: 'review'` + `gate.kind: 'reviewer_signoff'` → makes Review **mandatory before
  Aggregate** for code-writing runs. Removing the review stage is the explicit,
  user-confirmed opt-out (power users only).
- `gate` → loop control. On a gated stage's completion the orchestrator emits a
  `gate_pending` event and the graph transitions `active → blocked`; the run **waits** for
  a `gate.resolve` event from the `GateCard` (or the strip's `[Approve ▸]`). This is the
  load-bearing change that makes gates real instead of decorative.
- `handoffOverride` → merged into the generated `HandoffCard` before dispatch (spec 030).

**Run → UI (observation side):**
- `WorkflowStrip` reads `WorkflowRun.stageStates` 1:1. **Delete `currentStageIndex` and
  the magic numbers.** Editing/reordering stages now changes the editor AND the strip AND
  what runs — closing the "cosmetic" gap.
- Each stage's status derives from its seats' `AgentEvent`s (`tool_use` / `artifact` /
  `done`), mapping `seats` → live agents. The `atlas/beam/vera/orchestrator` cast flows
  from `seats`, not a separate hardcoded beat list.
- `depEdges` is populated from agent-declared deps at runtime (spec 060) and rendered as a
  read-only **badge** in v1 (`[Ask @owner to sync]` resolves a stale edge). The mini-graph
  stays a stretch.
- **Demo fixture:** the existing `RT.SCRIPT` stays as the *playback* of one real run, but
  a `runStateFromScript(workflow, clock)` reducer derives `WorkflowRun` keyed to the
  workflow's stages (build = parallel atlas+beam, review = gated vera) — the reducer reads
  the *workflow*, not magic time thresholds, so it's the same code path the live tRPC/SSE
  stream will feed.

**Audit trail:** each compiled dispatch logs to `ai-logs/handoffs.jsonl`; each gate
resolution logs approver + decision (the flight recorder).

## 8. How it raises output quality

"Raise vibecode quality" = structural discipline one-shot generators skip, **on by default
instead of remembered**:
- **Mandatory review pass.** `kind:'review'` + `reviewer_signoff` forces a second-role
  critique before Aggregate; nothing ships without it (the v0/Bolt gap). Surfaced as the
  `Review gate: on` quality-rail chip and the inline `GateCard`.
- **Gates that actually pause.** `active → blocked` awaiting `gate.resolve` turns "PM
  shipped without review" from a silent failure into an explicit, auditable approval.
- **Dependency awareness.** `depEdges` stale-flagging means changing one artifact surfaces
  what downstream is now stale (`Dependency-sync: on` chip + badge) — quality = not
  silently breaking callers.
- **Visible, editable hand-offs.** `seats[].brief` + `handoffOverride` make the carried
  context a 5-second user fix, logged to `ai-logs/handoffs.jsonl`.
- **Reusable skills.** Per-stage `skills` encode good practice once and apply it
  consistently (spec 070).

So quality = **plan → parallel role-work → mandatory review → dependency-aware iteration →
auditable hand-offs**, packaged so the discipline is the default.

## 9. Build plan (ordered; sprint-now vs later)

Each step ships standalone value; the riskiest work (run binding) is last so a 3-week
sprint survives intact.

**SPRINT-NOW (3 weeks):**

1. **Unify the data model + persist edits.** *(fixes the worst bugs; no run binding yet)*
   - NEW `src/contracts/workflow.ts`: zod `SeatRef`, `Seat`, `Gate` (discriminated),
     `Stage`, `Workflow`; `BUILTIN_WORKFLOWS` (role tokens in `seats`);
     `workflowToGalleryCard(wf)` (the single projection replacing `pipe`/`roles`).
   - NEW `src/contracts/workflow-run.ts`: `WorkflowRun` / stage-state schemas +
     `gate.resolve` event type.
   - `rt.js`: replace `WORKFLOW` with a full `Workflow` — convert `who:string[]` →
     `seats`, `parallel:bool` → `parallelGroup`, `gate:bool` → the `Gate` union
     (`build.parallelGroup`, `review.gate = reviewer_signoff(vera)`), add `kind`,
     `planning`, `version`, `origin`. Add `RT.workflows`, `RT.BUILTIN_WORKFLOWS`,
     `RT.SKILLS`. Remove `TEMPLATES` / `PIPE_DEFAULT` / `userTemplates`.
   - `workflow.jsx` `WorkflowView`: seed from and **write back to**
     `RT.workflows[workbench.workflowId]` (persist + bump version); kill the throwaway
     `useState`. Replace `saveTemplate`'s lossy projection (lines 127–135) with a lossless
     `Workflow` snapshot. Add `validateSpec` (see below).

2. **Round-trip Save / Fork + gallery-from-workflows.**
   - `modals.jsx`: drive the gallery from `BUILTIN_WORKFLOWS.concat(rt.workflows)` via
     `workflowToGalleryCard`; `onCreate({ name, workflow })` deep-clones the full
     `Workflow` (round-trip fixed). Pre-select + outcome-name the golden-path card; show
     fork provenance. **Remove** the inert `+ step` button; "Build your own" forks the
     opinionated default. Render role avatars from `seats`, not hardcoded roles.

3. **Stage-scoped roster + `StageDrawer` + quality-rail header.**
   - `workflow.jsx`: new `StageDrawer` (instructions, skills multiselect, gate radio,
     parallel toggle, hand-off preview with `[✎ Edit]`). `RolePicker` replacing the global
     `onAddAgent` passthrough (tabs: add-role / pick-existing-member / +You; bind adapter;
     allow `'user'`). Make `icon` pickable. Add the `Review gate: on` / `Dependency-sync:
     on` / `Plan: by role` header chips and diff toasts.
   - `modals.jsx`: generalize `AddAgentModal` to support a pick-existing-member path (drop
     `NAME_POOL`-only).
   - `ai.ts` + `app-root.jsx`: the **S6 recommendation banner** — `ai.recommendWorkflow` query
     (PM model via `defaultOrchestratorModel`) + a local keyword heuristic fallback + the
     dismissible Dock banner with inline reason and `[Use it]`.

4. **Bind the strip to real run state + the `GateCard`.**
   - `rt.js`: add a `WorkflowRun` fixture + `runStateFromScript(workflow, clock)` reducer
     (replaces `currentStageIndex`, lines 211–217).
   - `workflow.jsx` `WorkflowStrip`: take a `run` prop; render `stageStates`; **delete
     `currentStageIndex`**; add `blocked` (amber pulse) + click-to-gate; render
     `parallelGroup` as the fan-out pill.
   - NEW `GateCard` component (artifacts + anchored comments + Approve / Request-changes /
     Edit-handoff), wired to the `gate.resolve` event.

5. **Read-only "View definition" + diff.**
   - `workflow.jsx`: `View definition` toggle → YAML render of the `Workflow` (inspect /
     copy / share). Structural edits emit diff toasts. **No editable-YAML authoring.**

6. **Orchestrator dispatch binding** *(highest risk, last)*.
   - Dispatch reads `seats` for role→adapter, folds `brief`/`skills` into the HandoffCard
     (gap 1); `parallelGroup` → fan-out (gap 6); `kind:'review'` enforces
     review-before-aggregate; `gate` emits `gate_pending` and blocks until `gate.resolve`.

**Validation (enforced on Save and at dispatch):** a non-gate stage with empty `seats` is
invalid; ≥1 non-fixed stage must remain; ship may not precede a required review gate; a
`reviewer_signoff` gate requires a `@reviewer` seat upstream. Surfaced inline, blocking
Save/run.

**LATER (fast-follow, explicitly out of v1):**
- Cmd-K command palette for structural edits (the `StageDrawer` covers power editing for
  the demo).
- **Editable** YAML authoring with parse/validate/inline-error round-trip.
- The dependency mini-graph sidebar (v1 ships the badge only — golden-path stretch).
- Team/community share gallery + user-skill marketplace (PRD §5 out-of-scope).

## Companion artifacts to create in the same PR (per CLAUDE.md)
- This spec (`specs/090-workflows.md`).
- `ai-logs/decisions/ADR-009-workflow-as-spec-not-canvas.md` — records: (1) one
  `Workflow` editable object + a separate read-only `WorkflowRun`; (2) gates actually
  pause the run; (3) customization configures objects, never draws a DAG; (4) the eject is
  read-only YAML + diff, not author-time wiring.
