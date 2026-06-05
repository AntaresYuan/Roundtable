# ADR-010: Memory is explicit, layered, and audited — never opaque RAG

## Status

Accepted (2026-06-04)

## Context

A multi-agent product invites the obvious "memory" feature: embed past
chats, let agents query a vector store, let context just *show up*. ChatGPT
memory and mem0 / Letta have set the user expectation.

For Roundtable that path conflicts with three commitments the product is
already making:

1. **PM-centered orchestration.** The PM agent is the one editing what each
   agent sees. Background retrieval moves that control out of the PM and
   into the retriever — the user can no longer say "why did the agent
   know that" by reading `handoffs.jsonl`.
2. **Audit-trail differentiator.** Every spec, ADR, HandoffCard, and
   dispatch is recorded (`ai-logs/handoffs.jsonl`, the handoffs table).
   Opaque retrieval breaks that contract — what the agent saw cannot be
   reconstructed from the log.
3. **Hard project isolation.** Roundtable is multi-project (workbenches).
   A vector store of "the user's past stuff" implies the agent might be
   pulling from a different project than the one in front of it. That
   violates spec 100 invariant 1.

## Decision

Memory in Roundtable is **explicit, layered, and audited**, never opaque
RAG. Concretely:

1. **Three persistence scopes** — chat / workbench / user — with downward
   automatic inheritance and upward explicit promotion. See spec 100.
2. **Every HandoffCard's context is reconstructible** from those scopes'
   rows at the time of dispatch. The composition source breakdown is logged
   to `handoffs.jsonl`.
3. **Memory follows a storage → selection → injection → audit pipeline.**
   The database may hold a lot; agents receive a bounded, role-aware
   HandoffCard. If selected context exceeds budget, the Orchestrator compacts
   it into a source-linked brief before injection.
4. **Relationship graphs are selection aids, not hidden agent memory.**
   Artifact deps, handoffs, reviews, workflow seats, and saved skills help
   the Orchestrator find relevant context; the graph is not injected
   wholesale into the model.
5. **Cross-task "recall" is a user skill library**, not a vector store.
   The PM proposes saving useful patterns (ADR-007 propose/confirm flow);
   user clicks Save; the skill carries `source_chat_id` provenance; future
   tasks match it by visible `trigger_hint` keywords. The user can read,
   edit, or delete any skill at any time.
6. **Embedding similarity is permitted only as a ranking aid** over the
   explicit, audit-logged skill set — never as a substitute for it. Agents
   never see the embedding; they see a deterministic, logged set of mounted
   skills.

## Why

- **Keeps the moat.** Audit-trail + PM-centered orchestration are stated
  differentiators (PRD §7, ADR-008). RAG memory dilutes both.
- **Maps to the multi-project model.** Spec 100's scoped inheritance is the
  natural shape; RAG flattens it.
- **Users keep control.** Explicit promotion means the user knows what the
  agent will see next time. A vector store is opaque.
- **Debuggable.** When an agent does the wrong thing, the user can read
  exactly what it saw. With RAG, the answer is "embeddings retrieved these
  five chunks" — much harder to act on.

## Alternatives considered

- **Background embedding store of all chats + automatic retrieval.**
  Rejected — breaks audit trail (invariant 4 in spec 100), breaks workbench
  isolation (invariant 1), removes PM control.
- **Embedding store, but only over the user's own messages, not artifacts
  or other users' data.** Rejected — still opaque; the user can't tell
  what's about to be recalled, can't edit it, can't disable per task.
- **Auto-summarize past chats into a "memory" field at workbench/user
  level.** Considered for v2. Acceptable in principle because summaries are
  human-readable and auditable; rejected for v1 only to keep the surface
  small (skill library + user profile cover the use cases for now).

## What this enables in code

- `runDispatch` composes HandoffCard context by reading layered rows
  (user → workbench → chat) and logs the composition source to
  `handoffs.jsonl`. Implementation in #95–#100.
- A context-composition layer enforces budget, performs role-aware
  compaction when needed, and records the source breakdown that explains the
  final HandoffCard.
- The user-facing UI for "where did this come from" is the existing
  HandoffCard expanded view (spec 030 / #13) — already auditable; will
  grow a "source breakdown" section as part of #99/#100.

## Open questions

- When the user skill library grows large, will keyword `trigger_hint`
  matching underperform? Possible v2: embedding-assisted ranking over the
  explicit skill set (still audit-logged which skills are mounted). See
  spec 100 §10.
- Cross-user collaboration on a shared workbench: deferred. Will need ACL
  + an audit log entry per cross-user context pull.

## AI assistance

Drafted from the 2026-06-04 design conversation between
[@Gloria-Qi0311](https://github.com/Gloria-Qi0311) and Claude Code. The
three-scope model (chat / workbench / user) emerged from re-examining the
multi-project assumption that fixtures imply but the DB hadn't realized.

## Changelog

- 2026-06-04 — added pipeline / context-budget / relationship-graph /
  compaction detail after memory design review.
- 2026-06-04 — initial. Pairs with spec 100 (#94).
