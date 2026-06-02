# UI Design Handoff — Batch 1 (golden-path demo surface)

> **Hand this whole file to Claude design.** It is self-contained: Claude design does
> not need repo access. You (the designer) produce the look + interaction + component
> structure with **typed mock props**; the data-wiring (tRPC / streaming / real
> contracts) comes back to Claude Code afterward. Do **not** write any data fetching.

## 1. What you're designing for

Roundtable is a multi-agent collaboration workbench where a non-coder builds software by
working with coding agents the way a team works in a meeting. The organizing metaphor is a
**roundtable meeting** (see `ai-logs/decisions/ADR-008`): the conversation everyone shares
is the **main table**, a PM agent (the **Orchestrator**) facilitates, and when a sub-group
peels off to align they go into a **breakout room** the user can watch and step into. The
product's promise: **the user never reads raw terminal output** — every agent action shows
up as a card, an artifact, a diff, a preview, or a button.

Batch 1 designs the **main table** and the cards that live on it. Breakout rooms are a
later batch — but design the main table so a room can *open from it* (see §4.1).

**The one scenario these components must render (the demo):**

> A user types *"Build me a waitlist landing page that captures email + company size."*
> The Orchestrator plans it into parallel tasks, an implementer agent writes the files,
> a reviewer comments, and the user previews the running page — all at the table, no
> terminal.

Batch 1 = the four components that carry that scene: **chat shell (the main table)**,
**live TodoList card**, **artifact renderer**, **HandoffCard**.

## 2. Target stack & output format

- **React 18+ / TypeScript**, styled with **Tailwind CSS**. (The repo's frontend is
  greenfield — nothing is installed yet, so you have a clean slate. Components should be
  drop-in-able to **Next.js 15 App Router**; mark client components accordingly.)
- Each component takes **typed props only** (types in §4). **No** `fetch`, no tRPC, no
  API calls, no global stores. Data arrives via props.
- Deliver: (a) the component files, (b) one `fixtures.ts` with realistic golden-path
  sample data (the waitlist scenario), (c) one **demo page** that composes all four into
  the scene above so it can be viewed in isolation.
- If you need a field that isn't in the provided types, **don't invent it** — call it out
  in a "needs contract change" note (those types are owned by another teammate).

## 3. Cross-cutting visual system (the signature look)

This is the differentiator — get it consistent across all four components. The identity
should feel like a **calm meeting room**, not a noisy chat app: roomy, document-like,
agents present as distinct participants.

- **Per-agent color ownership.** Every agent carries a `color` (hex) + `displayName` +
  `role` + optional `avatar`. Use it as a **1px colored left border** on that agent's
  message groups and artifact cards, an avatar ring, and the role-tag background.
- **Role tags:** `@implementer`, `@reviewer`, `@architect`, `@planner`, `@fixer`.
- **The Orchestrator/PM** is visually distinct (a 👑) and **muted** — it speaks rarely;
  its messages should feel like quiet narration, not a loud agent bubble.
- Roles are exactly these five: `architect | planner | implementer | reviewer | fixer`.
  Propose a default 5-color palette, but every color must be driven by the `color` prop.

## 4. The four components

### 4.1 Chat shell  (issue #9)

**Purpose:** the app frame, and the **main table** of the roundtable. Left rail =
conversation list. Center = the active thread with streaming agent output. Bottom = a
composer with an `@mention`-capable input.

**Leave room for breakouts.** When two agents (or the user + an agent) peel off to align,
a side-conversation appears inline as `💬 @A and @B talked 2 turns ▸`. In batch 1 this is
just a **collapsed chip that reads as an enterable room — a door, not merely an "expand
text" toggle**. The full breakout room is a later batch; design the chip and reserve the
affordance now so the main table doesn't need re-skinning when the room arrives.

**The streaming model — critical.** Agent output arrives as a sequence of typed events.
You render a *message group* per agent (colored per §3) that consumes this stream:

```ts
type AgentRoleId = 'architect' | 'planner' | 'implementer' | 'reviewer' | 'fixer';

interface AgentIdentity {
  agentId: string;
  role: AgentRoleId;
  displayName: string;
  color: string;        // hex, drives all ownership coloring
  avatar?: string;      // emoji or url
}

type AgentEvent =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: unknown; isError?: boolean }
  | { type: 'file_change'; path: string; kind: 'create' | 'edit' | 'delete'; diff: string }
  | { type: 'artifact'; artifact: Artifact }   // → render with §4.3
  | { type: 'declare_dependency'; from: string; to: string; kind: 'derives_from' | 'replaces' | 'references' }
  | { type: 'done'; finishReason?: string; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } }
  | { type: 'error'; message: string; recoverable: boolean };
```

**How each event renders (the "no raw terminal" rule):**

| Event | Render |
|---|---|
| `thinking_delta` | a collapsed *"thinking…"* shimmer, expandable; never shown raw by default |
| `text_delta` | streamed markdown text in the agent's bubble |
| `tool_use` / `tool_result` | a single collapsed chip — *"🤖 Claude Code is working…"* with a spinner; expandable to detail. **Never dump tool JSON.** |
| `file_change` / `artifact` | promote to an **artifact card** (§4.3), not inline text |
| `done` | finalize the group (stop spinner) |
| `error` | inline error state on the group (red), `recoverable` → softer styling |

**States to design:** empty thread · user-just-sent · agent streaming (thinking → text →
working chip) · group complete · error.

---

### 4.2 Live TodoList card  (issue #12)

**Purpose:** the single *"Here's the plan"* card the Orchestrator posts. Shows the task
list with **live status badges**, **owner colors**, and **dependency arrows**. It updates
in place (one card, not new cards) as tasks move pending → running → completed.

```ts
interface PlanTask {
  id: string;                    // "T1", "T2", …
  title: string;                 // short imperative, e.g. "Scaffold landing page + form"
  assignee: `@${AgentRoleId}`;   // "@implementer"
  deps: string[];                // ["T1"] — ids this task waits on
  parallel?: boolean;            // true ⇒ runs alongside its siblings
  user_visible: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed';
}
interface Plan { id: string; createdAt: string; tasks: PlanTask[] }
// plus a lookup so rows can be colored by owner:
type AgentDirectory = Record<AgentRoleId, AgentIdentity>;
```

**Each row:** status glyph (`☐ pending · ⏳ running · ✓ completed · ❌ failed`) · task id ·
colored role tag (`@implementer`) · title. Show **dependency arrows** between rows
(`T3 → T2, T1`) and a subtle **parallel** indicator when sibling tasks run concurrently
(the demo's hero moment: two `@implementer` tasks running side by side).

**States:** all-pending · mixed (some running) · all-completed · has-failure (offers a
*Retry* affordance).

---

### 4.3 Artifact renderer  (issue #3)

**Purpose:** one dispatcher that renders an `Artifact` by `kind`. Batch 1 must nail
`file`, `diff`, `preview`; `doc`/`note` can be minimal.

```ts
interface Artifact {
  id: string;
  kind: 'file' | 'diff' | 'doc' | 'preview' | 'note';
  title: string;          // usually a file path, e.g. "index.html"
  ownerAgentId: string;   // → look up AgentIdentity for color/avatar/role
  version: number;        // 1, 2, … ; show as a v-chip
  uri?: string;
  preview?: string;       // inline content for preview/doc
  createdAt: string;
}
```

**Card chrome (all kinds):** 1px **owner-colored** left border · owner avatar + role tag ·
title · **version chip** (`v1`, `v2` — versions are a chain, not new cards) · expand to a
right-side drawer.

**Per kind:**
- `file` — code view (syntax-highlighted), collapsed by default with a peek.
- `diff` — a diff view. **Design for multi-author coloring**: lines authored by different
  agents tinted by their `color` (this is a flagship feature; the data wiring for "who
  wrote which line" comes later — for now design the affordance and accept a single-author
  diff in fixtures).
- `preview` — an `<iframe>` of the rendered page, with a **`▸ View code` / `▸ Open in
  drawer`** toggle (see Story B wireframe in §5).

**States:** loading · rendered · version-bumped (show the v-chip change) · error.

---

### 4.4 HandoffCard  (issue #13)

**Purpose:** render the context the Orchestrator passes to an agent as an inspectable
object. **Collapsed** = a one-liner; **expanded** = every field. Editing is a later
milestone — design the edit affordance (`✎`) but read-only is acceptable first.

```ts
interface ArtifactRef { id: string; kind: Artifact['kind']; title: string; uri?: string }

interface HandoffCard {
  id: string;
  from: string;                 // "orchestrator"
  to: string;                   // target role/agent
  scenario: 'dispatch' | 'agent_handoff' | 'join_group' | 'cross_chat'; // batch 1: 'dispatch'
  userIntent: string;           // the user's real ask, in plain language
  taskBrief: string;            // what this agent must do
  pinnedMessages: { id: string; content: string; pinnedBy: string }[];  // max 10
  rolesInGroup: AgentIdentity[];
  previousAgent?: { summary: string; keyOutputs: ArtifactRef[]; openQuestions: string[] };
  relevantArtifacts: ArtifactRef[];
  fullHistoryRef: string;
  createdAt: string;
  generatedBy: 'orchestrator';
}
```

**Collapsed:** `🔄 hand-off → @implementer  ▸`.
**Expanded:** `userIntent` · `taskBrief` · 📌 pinned messages · role roster (colored chips)
· (if present) previous-agent summary + key outputs + open questions · 📎 relevant
artifacts (as chips, **refs not embedded**) · `[✎ Edit hand-off]` `[Expand full history]`.
See Story C wireframe in §5.

## 5. Visual references (ASCII wireframes from the PRD)

**Story A — the batch-1 scene (chat + TodoList + artifacts + aggregate):**

```
 You:  Build me a waitlist landing page that captures email + company size.

 👑 PM (silent — picking team)
 👑 PM:
 ┌──────────────────────────────────────────────┐
 │  Splitting into 3 tasks. Dispatched:         │
 │  ☐ T2  @implementer  POST /api/waitlist  🚀  │   ← TodoList card (#12)
 │  ☐ T1  @implementer  Landing UI          ⏳  │
 │  ☐ T3  @reviewer     Diff review         ⏳  │
 │  [Show plan]                                 │
 └──────────────────────────────────────────────┘

 🟦 @implementer wrote LandingPage.tsx        v1  ▸    ← artifact cards (#3)
 🟩 @implementer wrote /api/waitlist.ts       v1  ▸
 💬 @implementer and @reviewer talked 2 turns  ▸       (breakout-room entry — chip now, room later)
 🟪 @reviewer  ReviewCard                        ▸
 👑 PM:
 ✅ Three artifacts shipped. Review left one nit.
 [Preview]  [Fix review note]  [Deploy to Vercel]      ← aggregate quick actions
```

**Story B — preview toggle (for §4.3 `preview`):**

```
 [v1 FeedbackWidget — sandbox preview]
 ┌──────────────────────────────────────────────┐
 │  ╭─ feedback widget mock ─────────╮          │
 │  │  How was your experience?      │          │   ▸ Open in drawer
 │  │  [submit]                      │          │   ▸ View code
 │  ╰────────────────────────────────╯          │
 └──────────────────────────────────────────────┘
```

**Story C — expanded HandoffCard (for §4.4):**

```
 ┌─ 🔄 PM → @security  (join_group) ─────────────────┐
 │  Task:  Security audit the auth flow we shipped.  │
 │  📌 Pinned constraints                            │
 │     • Deploy target: Vercel + Postgres            │
 │  💬 Project summary (built by PM, editable)       │
 │     30 turns of work. Built: LoginForm.tsx, …     │
 │  📎 Relevant artifacts (refs only)                │
 │     [LoginForm.tsx v3] [api/login.ts v2]          │
 │  [✎ Edit hand-off]   [Expand full history]        │
 └───────────────────────────────────────────────────┘
```

## 6. Deliverable checklist

- [ ] `ChatShell` + message-group/streaming sub-components (§4.1)
- [ ] `TodoListCard` with live badges + dep arrows + parallel indicator (§4.2)
- [ ] `ArtifactRenderer` dispatching `file` / `diff` / `preview` (§4.3)
- [ ] `HandoffCard` collapsed + expanded (§4.4)
- [ ] `fixtures.ts` — golden-path (waitlist) sample data for every component
- [ ] one **demo page** composing the Story-A scene
- [ ] consistent per-agent color system across all of the above (§3)
- [ ] "needs contract change" notes for any field you wished existed

## 7. When this comes back to Claude Code

Integration (not your job, listed so the seam is clear): install Next.js 15 + Tailwind,
drop the components into the App Router, replace fixtures with the live tRPC/SSE stream,
reconcile any "needs contract change" notes with the contracts owner.
