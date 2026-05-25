# ADR-001: Choose LangGraph.js over AutoGen for Orchestration

## Status

Accepted (2026-05-22)

## Context

We need a TypeScript-native orchestration framework for the Roundtable Orchestrator. The Orchestrator runs a 6-stage state machine (Intake → Clarify → Plan → Dispatch → Monitor → Aggregate), maintains an artifact dependency graph, and supports human-in-the-loop interruption.

Candidates evaluated: LangGraph.js, AutoGen, CrewAI, OpenAI Agents SDK, Mastra.

## Decision

LangGraph.js + Vercel AI SDK + CopilotKit (for UI primitives).

## Why

- **TypeScript maturity.** LangGraph.js is production-ready in TS. AutoGen's v0.4 actor model has no TS port; we'd need to wrap a Python service. CrewAI is Python-first too.
- **Checkpoint + HITL.** LangGraph's `interrupt()` is best-in-class for pausing mid-execution and letting the user intervene — central to our HandoffCard editing flow.
- **State semantics.** LangGraph's typed state with reducers maps cleanly onto our `RoundtableState` (messages, artifacts, handoffs, pinned, dependency graph).
- **Mastra wraps LangGraph anyway.** If we ever want Mastra's DX, the underlying primitives match.
- **OpenAI Agents SDK** is too coupled to OpenAI and lacks our checkpointer story.
- **CrewAI hierarchical** is too rigid around "roles" — we want emergent routing.

## AI assistance

- Claude Code researched all five frameworks and produced a comparison matrix (`ai-logs/prompt-history/2026-05-22-framework-comparison.md`).
- We asked Claude to play devil's advocate against LangGraph (`ai-logs/prompt-history/2026-05-22-langgraph-pushback.md`); the strongest counter was learning curve, which we accepted as a one-week onboarding cost.
- Final decision: team meeting, ~30 min.

## Consequences

- We have to learn LangGraph's state-reducer semantics (one-week onramp).
- Easy migration path to Mastra later if DX becomes the bottleneck.
- HITL via `interrupt()` requires a Postgres checkpointer — see ADR (TBD) on checkpointer choice.
- We commit to TS end-to-end for the orchestration layer.
