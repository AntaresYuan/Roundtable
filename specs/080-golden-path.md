# Spec 080: Golden Path — The Scenario the Demo Must Win

> **Status: DRAFT for review.** This spec fixes the single end-to-end scenario the
> 3-minute demo video is built around, and stages the build so that *every milestone
> produces a recordable demo*. It supersedes the earlier "landing-page slice" framing
> of this spec, which under-sold the product's differentiators (see Changelog).
> If a feature does not serve this path, it is out of scope until the path is green.

## Why this spec exists

Specs 000–070 describe *what the system can do*. The PRD (`docs/prd.md`) names the
demo's evaluation rubric. Neither pins down *the one story the demo must show* and
*the order we build it in*. Without that anchor, build effort spreads across breadth
(more contracts, more roles, more artifact kinds) instead of driving one narrow, real,
vertical slice to completion — and then **dressing that slice up with the four moat
features the rubric actually rewards**.

This spec is the anchor. It is concrete, and it is staged.

## The load-bearing lesson behind this rewrite

An earlier draft of this spec chose a single-implementer landing-page run as "the one
scenario the demo must run." That path is a fine *integration target* but a poor *demo
target*: it deliberately deferred group-chat routing (spec 050), the dependency-changed
badge (spec 060), HandoffCard editing (spec 030), and multi-author diff coloring
(spec 040) — i.e. **all four of the differentiators the PRD calls the moat** (PRD § 7).

By the PRD's own definition, that is disqualifying. PRD § 6 defines the
*functional-completeness* bar (25% of the grade) as "**all five core capabilities (§ 3)
demonstrably work in the 3-min demo.**" A single-implementer run demonstrates at most
two of them. As the differentiation analysis puts it: a landing page built without these
"is just Claude Code + group chat — which Cursor, v0, Coze would all claim to do."

So this spec keeps the thin landing-page slice — but only as **Milestone 1**, the
stepping stone, not the finish line.

## The scenario (one sentence)

> A non-coder asks Roundtable to build a waitlist landing page; the Orchestrator plans
> it into **parallel** UI + API tasks, **real Claude Code agents** implement them as
> separately-owned artifacts, a reviewer comments and then **edits the implementer's
> file** (multi-author diff), a **dependency-changed badge** fires when the API bumps,
> the **HandoffCard is inspectable and editable**, and the user previews the running
> page — without ever reading raw terminal output.

This is **Story A** from `docs/prd.md` § 4, made executable.

## The cast

| Role | Played by (demo) | Job in this scenario |
|---|---|---|
| User | A non-programmer | Types one request; expands a hand-off; clicks Preview / Apply fix |
| Orchestrator (PM) | LangGraph state machine (spec 010) | Intake → plan → **parallel** dispatch → review → aggregate |
| Planner | Orchestrator-internal step (**not** a dispatched task) | Breaks the request into parallel UI + API tasks |
| Implementer | **Claude Code adapter (real, not mock)** | Writes `LandingPage.tsx` and `api/waitlist.ts` |
| Reviewer | Claude Code adapter, **second role** | Leaves ≥1 substantive comment, then edits the file on "Apply fix" |

The implementer being a **real adapter** is load-bearing twice over: the demo's thesis
("a friendly surface over real coding CLIs") is false if the implementer is the mock,
**and** the mandatory review pass only fires when a `file_change` event is observed
(`src/orchestrator/nodes/review.ts`), which the mock never emits.

## Milestones — each one is a recordable demo

The path is built in stages. **Any milestone can be the demo if we run out of time**;
each later milestone lights up one more rubric-rewarded differentiator. Build order is
strict because each milestone reuses the previous one's plumbing.

| Milestone | Adds on top of previous | Differentiator lit | Rubric fed |
|---|---|---|---|
| **M1** — pipe flows | Single implementer writes the page; reviewer comments; Preview renders | (none — proves the pipe) | functional-completeness floor |
| **M2** — parallel team | Plan splits into UI ‖ API; two color-owned artifacts land concurrently; agent side-conversation collapses to a chip | group-chat parallelism + observable side-convo | AI collaboration (30%) |
| **M3** — dependency graph | `api/waitlist.ts` bumps version → `LandingPage.tsx` card surfaces **⚠️ dependency changed** + `[Ask @owner to sync]` | first-class dependency graph (the "innovation 分水岭") | innovation (10%) + quality (20%) |
| **M4** — editable hand-off | The dispatch HandoffCard expands, the user **edits a field**, re-dispatch honors the edit | HandoffCard as editable UI ("答辩核武器") | AI collaboration (30%) |
| **M5** — multi-author diff | On **Apply review fix**, the reviewer/fixer edits the implementer's file → diff lines colored per author | multi-author diff coloring ("no shipping product has this") | innovation (10%) + quality (20%) |

> **Multi-author diff — where it lives (resolved).** Multi-author coloring requires two
> *different* agents editing the *same* file. Story A does not produce that naturally
> (the implementer writes both files; the reviewer only comments). Rather than fabricate
> a contrived beat, we give it a real home: the **"Apply review fix"** Quick Action
> dispatches a `fixer`/reviewer edit against `LandingPage.tsx`, which the `implementer`
> authored — so the resulting diff legitimately has two authors. This is **M5**. If M5
> slips, multi-author diff degrades to a static screenshot in the § 3.3 discussion and
> is cut from the live demo cut — an explicit, logged downgrade, not a silent gap.

## The beat sheet (what the user sees, at M5 / full demo)

1. **User message.** *"Build me a waitlist landing page that captures email + company
   size. Should look modern."* Nothing else.
2. **Intake.** Orchestrator classifies: intent = `build`, clarity high enough to skip
   clarify, suggested roles = `[implementer, reviewer]` (planner runs *internally*).
   - *Visible:* a short "Here's the plan" message, not a JSON blob.
3. **Plan.** Orchestrator emits task cards — **two of them parallel**:
   - `T1 @implementer` — `LandingPage.tsx` (form: email + company size, modern styling)
   - `T2 @implementer` — `api/waitlist.ts` (stub submit handler / collect-email stub)
   - `T3 @reviewer` — review the page + API for correctness and obvious UX issues
   - *Visible:* a single live `TodoList` card; T1 ‖ T2 run concurrently, T3 depends on both.
4. **Handoff (editable).** Before dispatch, a **HandoffCard** (spec 030) renders
   collapsed (`🔄 hand-off → @implementer`). The user expands it, can **edit** the brief,
   and re-dispatch honors the edit.
   - *Visible:* `userIntent`, `taskBrief`, role roster, `[✎ Edit]`.
5. **Parallel dispatch → real implementer.** The Claude Code adapter runs T1 and T2
   **concurrently**, streaming. The user never sees raw `stream-json` — they see two
   collapsed "Claude Code is working…" bubbles in **distinct owner colors**, then files.
   - *Visible:* two `file` artifacts with owner color + version chain; an agent
     side-conversation collapses to `💬 talked 2 turns ▸`.
6. **Dependency badge.** When `api/waitlist.ts` bumps (e.g. the reviewer asks for a field
   rename), `LandingPage.tsx`'s card surfaces **⚠️ dependency changed** with
   `[Ask @implementer to sync]`.
   - *Visible:* red badge + one-click resync producing a pre-filled HandoffCard.
7. **Review + multi-author fix.** T3 leaves ≥1 real comment ("no client-side email
   validation"). User clicks **Apply review fix**; the fix edits `LandingPage.tsx` →
   the diff shows implementer's original lines and the fixer's lines in two colors.
   - *Visible:* review comment tied to the artifact; a per-author colored diff.
8. **Aggregate + Preview.** Orchestrator summarizes (built / flagged / fixed) with Quick
   Actions: **Preview**, **Deploy**. User clicks **Preview** and sees the page render.

If beats 1→8 run with a real implementer and a human never needs the terminal, the
demo proves the thesis *and* exercises all four moat features.

## Definition of done (the green bar)

Green is **staged**. M1 is the integration floor; M5 is the demo we ship.

### M1 — pipe flows (integration floor)
- [ ] User sends one plain-language message; no further typing required until Preview.
- [ ] The user's *actual request* reaches the implementer (blocked on Known gap 1 —
      the dispatcher currently sends only the role title).
- [ ] The implementer is the **real Claude Code adapter** and writes real files.
- [ ] Emitted `artifact` events are collected into a state-level `Artifact[]` (blocked
      on Known gap 2 — the adapter emits them but nothing surfaces them).
- [ ] Generated `file` artifacts render in the UI (not raw text dumps).
- [ ] The reviewer leaves ≥1 substantive comment **tied to an artifact** (blocked on
      Known gap 4 — review notes are bare `string[]` with no artifact anchor).
- [ ] An aggregate summary + Quick Actions appear; **Preview** renders the page.
- [ ] At no point must the user read raw `stream-json` / terminal output.

### M2 — parallel team
- [ ] Plan splits into ≥2 concurrently-dispatched tasks with distinct owner colors.
- [ ] An agent side-conversation renders as a collapsible chip.

### M3 — dependency graph
- [ ] An upstream artifact version bump surfaces **⚠️ dependency changed** on the
      downstream card, with a working `[Ask @owner to sync]` action.

### M4 — editable hand-off
- [ ] The dispatch HandoffCard expands; the user edits a field; re-dispatch uses it.

### M5 — multi-author diff
- [ ] **Apply review fix** produces a diff on `LandingPage.tsx` colored by ≥2 authors.

## Known gaps between this path and the current skeleton

Re-verified against `main` @ `17e08ee` (orchestrator runtime foundation) on 2026-05-31.
That commit shipped a real Claude Code adapter and an LLM planner, which **closed part
of the original audit** — flagged `(half-closed)` inline below.

1. **User intent never reaches the implementer.** *(open)* `dispatch.ts:88` sends
   `card.taskBrief` as the message and `:81` as the system prompt; `taskBrief = task.title`
   (`dispatch.ts:28`), a short role label. The user's real request sits unused in
   `card.userIntent` (`:27`). The real adapter forwards `systemPrompt` via
   `--append-system-prompt` and `input.text` as the user turn, so the implementer's entire
   instruction is the task title.
2. **Emitted `artifact` events are not collected into state.** *(half-closed)* The real
   Claude Code adapter now **does** emit `{ type: 'artifact' }` events alongside
   `file_change` (`adapters/claude-code/normalize.ts:150-165`, `kind: 'file'`). Still
   missing: `OrchestratorState` has no `artifacts` field (`state.ts:47-59`), the graph has
   no `artifacts` channel (`graph.ts:41-53`), and `aggregate.ts` only makes text bullets —
   so emitted artifacts stay buried in `dispatch[].events` with nothing surfacing them for
   the UI. **Decision (updated):** add `artifacts: Artifact[]` to state and drain `artifact`
   events into it; do **not** re-synthesize from `file_change` — the adapter already
   produces them.
3. **Reviewer is blind.** *(open)* `buildHandoffCard` hardcodes `relevantArtifacts: []`
   (`dispatch.ts:31`) and the reviewer is dispatched with only its role title — it cannot
   see the diff it must review.
4. **Review notes can't anchor to artifacts.** *(open)* `Reviewer.review()` returns
   `string[]` (`review.ts`) and state stores `reviewNotes: string[]` (`state.ts:56`); needs
   `{ artifactId, line?, body }` to satisfy "tied to an artifact."
5. **The LLM planner exists but is not the default.** *(half-closed)* `llm-planner.ts`
   can now emit the golden-path shape — multiple `@implementer` tasks, `parallel: true`,
   position-based `deps`, and `user_visible: false` for internal planning. But `graph.ts:83`
   defaults to the old `rolePlanner()` (1:1 `suggestedRoles`→tasks), which still yields
   `T1 @planner / T2 @implementer / T3 @reviewer`. Fix = wire `llmPlanner` as the
   orchestrator's planner (it already falls back to `rolePlanner` on LLM failure).
6. **Dispatch runs sequentially and ignores `parallel`.** *(open)* `dispatch.ts:59` awaits
   each task in a `for` loop, so even a plan marked `parallel: true` runs serially. M2's
   "two color-owned artifacts land concurrently" needs dispatch to fan out parallel siblings.

M1 is blocked on gaps 1, 2, 4 (and gap 3 for a grounded review). M2 is blocked on gaps
5 and 6. The real Claude Code adapter itself is **built** (`adapters/claude-code/`); M1's
remaining adapter work is binding it to the `implementer` role and fixing gap 1.

## Explicitly out of scope for the golden path

Even though specs cover them, these stay out until M5 is green:

- A second concrete adapter (OpenCode/Codex). The path is provable with Claude Code in
  two roles. Add only after M5 — it is the "multi-CLI" garnish, not the moat.
- `agent_handoff` / `join_group` / `cross_chat` HandoffCard scenarios (spec 030) — the
  demo uses `dispatch` only. (Story C's `join_group` is a *stretch* second demo beat.)
- Cycle detection / full React Flow mini-graph (spec 060) — a single downstream badge is
  enough; the sidebar graph is a stretch.
- Persistence / auth / multi-project — a single in-memory session is fine for the demo.

## What this unblocks (derived work)

1. **Bind the (now-built) Claude Code adapter** to the `implementer` role and fix gap 1
   so the user's request reaches it (the adapter landed in `17e08ee`; skills:
   `debug-stream-json`, `add-agent-adapter`).
2. **Orchestrator wiring** for gaps 1–5 above — the bulk of M1/M2.
3. **Minimal UI** rendering: the live TodoList, an editable HandoffCard, color-owned
   `file` artifacts, a per-author `diff`, the dependency badge, review comments, the
   aggregate summary, and a `preview` surface.
4. **Artifact contract reconciliation** — the PRD lists 7 kinds
   (`code/diff/web_app/markdown/mermaid/html/spec`); `src/contracts/artifact.ts` has 5
   (`file/diff/doc/preview/note`). The demo path needs only `file`, `diff`, `preview`,
   `note`, all present — so reconciliation is **non-blocking** for this slice; do it
   when a beat actually needs a missing kind.

## Open questions

- Does T2 (form submit) need a real backend stub, or is a fake success state enough?
  **Resolved: fake success state** — a real backend pulls e2b/deploy into the slice.
- Preview via e2b sandbox vs. a static iframe of the generated `index.html`?
  **Resolved: static iframe first** (zero-dependency for a generated page); e2b is the
  later **Deploy** action, not the **Preview** action.
- Reviewer = same Claude Code adapter in a second role, or a second CLI?
  **Resolved: same adapter, second role** — but only after gap 3 (reviewer blindness) is
  fixed, else any CLI is equally blind.
- Which milestone is the freeze target if the sprint runs short? **Bias: M3** (parallel
  + dependency badge is the smallest cut that still beats "Claude Code + group chat").

## Changelog

- 2026-05-31 — re-verified Known gaps against `main` @ `17e08ee`. Gaps 2 and 5 are now
  half-closed (the real adapter emits `artifact` events; the LLM planner can express the
  parallel shape); added gap 6 (sequential dispatch ignores `parallel`); noted the real
  Claude Code adapter is built.
- 2026-05-31 — **rewrite.** Reframed from a single-implementer landing-page slice into
  the staged Story A demo path (M1–M5). The original slice survives as M1. Added the
  multi-author-diff resolution, the M-stage rubric mapping, and the Known-gaps audit of
  `src/`. Rationale: the prior framing deferred all four PRD § 7 differentiators and
  could not meet the PRD § 6 functional-completeness bar.
- 2026-05-31 — initial draft (golden-path anchor for the sprint demo).
