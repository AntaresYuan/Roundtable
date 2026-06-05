# Spec 100: Memory layers — chat / workbench / user

> **Status: DRAFT for review.** Locks in the three persistence scopes used by
> every other spec, the inheritance/promotion rules that move data between
> them, and the hard isolation invariants that prevent cross-project bleed.
> A companion ADR (`ai-logs/decisions/ADR-010-explicit-layered-memory.md`)
> records the load-bearing decision: **memory in Roundtable is explicit,
> layered, and audited — never opaque RAG.**

## 1. Goal

"Memory" in Roundtable is not a single store. It is **what an agent gets to
see when it starts working** — and that depends on which task, which project,
and which user the run belongs to. Without an explicit model, three failure
modes show up: agents in a new chat can't see code from the previous chat
("context lost"); a user's hard preference has to be re-stated everywhere
("preference amnesia"); a workbench's project context leaks into an unrelated
workbench ("context bleed"). This spec fixes those by naming three scopes,
saying what lives where, and stating the rules that move data between them.

## 2. Non-goals

- **No automatic vector recall.** Roundtable does not embed past chats and let
  agents pull "relevant memories" silently — that would break the
  audit-trail invariant. See §7 and ADR-010 for the alternative.
- **No cross-user memory.** A user's data never crosses to another user
  except through the explicit `cross-chat handoff` export path or a future
  shared marketplace (out-of-scope for v1, see §10).
- **No retroactive context updates.** Changing a higher-scope value (e.g.
  user profile) affects **new** dispatches; it never rewrites running tasks'
  snapshots.

## 3. The three scopes

```
┌────────────────────────────────────────────────────────────┐
│ L5 USER                                                    │
│   identity, profile, default brief, saved skills,          │
│   saved workflow library, custom agents                    │
├────────────────────────────────────────────────────────────┤
│ L4 WORKBENCH (= project)                                   │
│   shared workspace path, project's artifacts / versions /  │
│   dep graph, active Workflow, project pinned constraints,  │
│   workbench-level skill set, seated members                │
├────────────────────────────────────────────────────────────┤
│ L3 CHAT (= one task)                                       │
│   conversation messages, this task's handoff chain,        │
│   task-only pinned, gate decisions, review comments,       │
│   orchestrator run checkpointer state                      │
└────────────────────────────────────────────────────────────┘
```

(L1 = single agent turn; L2 = single adapter session within a dispatch.
Both are technical sub-units of L3 and not directly user-visible. L6 = global
platform — built-in skills + built-in workflows, read-only, shipped in the
repo.)

## 4. What lives where (concrete)

| Lives in | Examples | DB / module |
|---|---|---|
| **L5 User** | identity, email | `users` |
| | custom agent definitions (bind a CLI to a role) | `custom_agents` |
| | default brief ("I prefer server components") | `user_profiles` (TBD #99) |
| | saved skill library (propose-saved from past chats) | `user_skills` (TBD #100) |
| | user-saved workflow templates | `workflows` rows with `workbench_id = NULL` (TBD #97) |
| **L4 Workbench** | the project's identity, name, description | `workbenches` (TBD #95) |
| | shared workspace directory | `workbenches.workspace_path` (TBD #95) |
| | the project's artifacts + version chain + dep graph | `artifacts.workbench_id` (TBD #96) |
| | the project's active Workflow definition | `workbenches.active_workflow_id` (TBD #97) |
| | project-wide pinned constraints | `workbench_pinned_messages` (TBD #98) |
| **L3 Chat** | the task's conversation | `messages.chat_id` |
| | this task's HandoffCard chain | `handoffs.chat_id` |
| | this task's pinned constraints (temporary) | `pinned_messages.chat_id` |
| | orchestrator's full run state | LangGraph checkpointer keyed to chat |
| | gate decisions, review comments | `OrchestratorState.{gateDecisions,reviewComments}` |
| | per-task agent sessions | `agent_sessions.chat_id` |

Anything not on this table either does not need persistence (L1/L2) or is
platform-shipped (L6, the `skills/` directory and `BUILTIN_WORKFLOWS`).

## 4.5 Memory pipeline — storage → selection → injection → audit

Persistent memory is only the first step. Roundtable never treats "stored"
as equivalent to "agent-visible." Each dispatch goes through four explicit
steps:

1. **Storage.** Durable rows live in the scoped stores above (L3/L4/L5).
   In local development this is the local Postgres; in production this is
   the cloud Postgres. The model itself is not the long-term store.
2. **Selection.** The Orchestrator resolves the current user / workbench /
   chat, then chooses only the rows relevant to the task, role, workflow
   stage, and artifact graph.
3. **Injection.** Selected context is folded into a small HandoffCard:
   `userIntent`, `taskBrief`, `pinnedMessages`, `relevantArtifacts`,
   mounted skills, and source breakdown. Agents see the HandoffCard, not
   the whole database.
4. **Audit.** The final HandoffCard plus its source breakdown is written to
   `handoffs.jsonl` / the handoffs table so "why did the agent know this?"
   is answerable after the fact.

This is the load-bearing distinction from opaque memory systems: memory can
be large, but agent-visible context must be deliberate, bounded, and logged.

## 4.6 Relationship graph — useful for selection, not a hidden brain

Roundtable does use graph-shaped memory, but not as a general-purpose
"knowledge graph platform" in v1. The explicit relationship graph starts
from product objects the user can inspect:

- `chat produced artifact`
- `artifact depends_on artifact`
- `review_comment comments_on artifact`
- `handoff carried artifact_ref`
- `workflow stage uses seat/agent`
- `user_skill saved_from chat`

The graph helps the Orchestrator **find the right context**. For example,
if a user says "sync the form," the graph can locate the frontend artifact,
its API dependency, unresolved review comments, and any matching saved
skill. The graph itself is not injected wholesale into the model; only the
selected refs / comments / skills enter the HandoffCard.

## 5. Inheritance — downward, automatic

When the orchestrator builds a HandoffCard for a dispatch, it composes
context **top-down**, narrowest scope last:

```
L6 built-in skills (matched by trigger_hint)
  → L5 user.default_brief + user.default_skills
    → L4 workbench.brief + workbench.skills + workbench.pinned
      → L3 chat.pinned + this seat's brief + relevantArtifacts
        → final HandoffCard.taskBrief + .pinnedMessages + .skills
```

Rules:

- **Automatic.** No user action needed. New tasks inherit the user's profile
  and the workbench's project state by virtue of being created under them.
- **Lower wins on conflict.** If user-level brief says "server components"
  and the chat-level brief overrides with "client components for this task,"
  the chat wins. Lower scope is more specific.
- **Caps stack but truncate at lower.** Pinned messages cap at 10. If
  workbench has 5 and chat has 8, the chat's 8 are kept; workbench
  contributes the 2 not-overridden until 10. Chat always wins over workbench.

## 6. Promotion — upward, explicit

A chat that produces a reusable pattern (a useful pinned, a good skill, a
worth-keeping workflow) **does not propagate upward automatically**. The user
must take a visible action:

| Promotion | Trigger | What lands where |
|---|---|---|
| chat pin → workbench pin | "Save to project" button on a pinned message | row in `workbench_pinned_messages`; chat row stays or is removed (user's choice) |
| chat pattern → user skill | PM proposes `propose_skill` event; user clicks "Save as my skill" in the modal | row in `user_skills`; provenance carried via `source_chat_id` |
| chat brief → user profile | "Save to my preferences" on the seat brief in HandoffCard | append to `user_profiles.default_brief` |
| this workflow → my library | "Save as my workflow" in the Workflow tab (spec 090 §6) | `workflows` row with `owner_user_id`, `workbench_id = NULL` |
| my workflow → workbench | "Apply to this workbench" / fork-and-bind | `workbenches.active_workflow_id` updated |

The PM **never** auto-promotes (ADR-007 — PM proposes, user confirms).

## 7. Invariants

These are the hard rules. If a design choice would break one, redesign.

1. **Workbench isolation.** Two workbenches owned by the same user share
   nothing automatically — not artifacts, not pinned, not workflow, not
   skills. Crossing requires an explicit `cross-chat handoff` export.
2. **Same-workbench chats share project state, not task conversation.**
   Chat B in the same workbench sees chat A's artifacts and workflow
   automatically; it does **not** see chat A's messages, HandoffCards, or
   review comments. Carrying them across is explicit (cross-chat handoff
   from #45).
3. **Inheritance flows down; promotion flows up only on user action.** No
   chat-level data leaks upward to workbench or user scope without a click.
4. **Every agent-visible context decision is auditable.** Whatever ends up
   in a HandoffCard is reconstructible from the layered sources — listed in
   `handoffs.jsonl` with provenance. This rules out opaque RAG (see ADR-010).
5. **No retroactive context.** Mutating a higher-scope value (e.g. updating
   `user_profiles.default_brief`) affects **new** dispatches only; in-flight
   runs keep the snapshot they started with.

## 8. What this rules out

- **Vector-store automatic recall.** No background process embeds past
  artifacts/messages and lets agents query "find me similar past bug fixes."
  The explicit alternative is the user skill library (#100) — same outcome,
  visible matching, user-editable, with provenance.
- **Cross-workbench leakage.** No "agent has been seeing your other projects"
  surprise. If a user wants insight from one project applied to another, they
  promote to user-scope explicitly.
- **Silent context truncation.** When the inheritance chain produces more
  than the cap (pinned ≤ 10, HandoffCard prompt size limit), truncation is
  deterministic (lower scope wins; oldest dropped within a scope) and the
  full original is in `handoffs.jsonl`.

## 9. How the orchestrator builds context (compact picture)

```
runDispatch(state) for a task:
  1. resolve workbench from state.chatId
  2. resolve user from workbench.owner_user_id
  3. compose layered context:
       briefs    = [user.default_brief, workbench.brief, seat.brief].filter(present)
       skills    = unique(user.default_skills ++ workbench.skills ++ seat.skills)
       pinned    = (workbench.pinned ++ chat.pinned).dedupe.cap(10)
       artifacts = workbench.latest_artifacts.filter(relevant_to_task)
  4. generateHandoffCard with the composed input
  5. log the composition source breakdown to handoffs.jsonl
```

Implementation note: §9 is a target picture. Today, dispatch reads chat-only
sources. The migration plan is the sub-issues (#95–#100), in roughly that
order — see the issue thread.

### 9.1 Context budget

The store can grow indefinitely; the HandoffCard cannot. Each dispatch must
enforce a context budget before agent invocation. Initial v1 rules:

- Pinned messages cap at 10 after workbench + chat merge.
- Artifacts are passed by refs by default; full content/diffs are included
  only when the role needs them (for example reviewer/fixer).
- Review context prefers unresolved/blocking comments over resolved history.
- Dependency graph context is limited to directly relevant upstream /
  downstream edges.
- User skills are mounted only when their visible `trigger_hint` matches the
  task; cap to the smallest useful set.
- Chat history is summarized or referenced; full raw history is not forwarded
  to downstream agents.

Lower scope still wins inside the budget: chat-specific context is more
important than workbench context, which is more important than user defaults.

### 9.2 Role-aware compaction

When selected context still exceeds the budget, the Orchestrator compacts it
into a structured, lossy brief before injection. Compaction is role-aware:

- **Implementer** gets task goal, relevant artifact refs, project constraints,
  and acceptance criteria.
- **Reviewer** gets changed artifact refs/diffs, acceptance criteria, and
  known risk areas.
- **Fixer** gets the failing check, review comments, and the narrow files to
  touch.
- **Sync agent** gets the upstream version bump, downstream artifact, and the
  dependency reason.

Compaction never replaces the original source rows. The compacted brief must
record which messages, artifacts, reviews, pins, and skills it came from so
the audit trail can reconstruct the agent-visible snapshot.

## 10. Open questions

- **Cross-user collaboration.** Two users on the same workbench (paired
  coding, shared squad). Out-of-scope for v1; would need a `workbench_members`
  table and ACLs.
- **Platform skill marketplace.** Users sharing skills with the community.
  PRD §5 explicit out-of-scope.
- **L4 / L5 embedding-assisted search.** If a user's skill library grows
  past ~50, keyword matching for `trigger_hint` may underdeliver. Embedding
  matching is acceptable **only as a ranking aid** over the explicit skill
  set — agents still see a deterministic, audit-logged set of mounted
  skills. No silent retrieval.

## 11. Companion artifacts

- `ai-logs/decisions/ADR-010-explicit-layered-memory.md` — the
  no-opaque-RAG decision.
- Issues #94–#100 — the implementation plan.

## Changelog

- 2026-06-04 — added memory pipeline, relationship-graph boundary, context
  budget, and role-aware compaction details.
- 2026-06-04 — initial draft (#94). Frames the three scopes, inheritance,
  promotion, and invariants. Implementation lives in #95–#100.
