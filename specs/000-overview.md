# Spec 000: Roundtable — Product & System Overview

## Goal

A multi-agent collaboration platform that *feels like a group chat*, where each agent is a Coding Agent (Claude Code, OpenCode, Codex, or user-built) with a role and a color, an Orchestrator (PM) routes work via `@mentions`, and every artifact, hand-off, and dependency is a first-class product object.

## Non-goals

- Not a generic LLM chat client. Roundtable is opinionated about coding workflows.
- Not a workflow builder (no node-graph editor). Coordination emerges from chat + Orchestrator behavior, not from a canvas.
- Not a model-routing service. Agents bring their own model; we orchestrate them.

## Differentiation axis

**Group-chat semantics for agents.** Specifically:

1. `@mention` routing with explicit and implicit (selector-based) dispatch.
2. Per-agent artifact ownership: every artifact carries an agent color, version chain, and dependency declarations.
3. Visible hand-offs: every PM→agent and agent→agent context transfer renders as a `HandoffCard` (see spec 030) the user can read, edit, and replay.
4. Observable side-conversations: agent-to-agent talk is collapsed by default, expandable on demand, and the user can interject.

## Pillars

| Pillar | Spec |
|---|---|
| Orchestrator state machine | 010 |
| Agent Adapter contract | 020 |
| HandoffCard | 030 |
| Artifact types & rendering | 040 |
| Group chat routing | 050 |
| Dependency graph | 060 |
| Skills system (build + runtime) | 070 |

## Tech stack & why

- **Next.js 15 + App Router** — server components for fast initial paint; streaming responses for agent output.
- **LangGraph.js** — TS-native orchestration with explicit checkpoint + `interrupt()` for HITL (see ADR-001).
- **Vercel AI SDK** — uniform LLM provider abstraction; powers Custom Agent runtime.
- **CopilotKit** — generative UI primitives (clarify cards, todo lists, quick actions).
- **tRPC + Drizzle + Postgres** — typed end-to-end; SSE for streaming.
- **e2b sandbox** — live previews for `web_app` artifacts (long-tail artifacts render statically).

## Milestone gates

- **Day 5 (D5)** — single-chat happy path with one adapter (Claude Code).
- **Day 10 (D10)** — group chat with two adapters, Orchestrator 6-stage loop mocked end-to-end.
- **Day 14 (D14)** — HandoffCard live; artifact dispatcher renders ≥ 4 kinds; OpenCode adapter live.
- **Day 19 (D19)** — freeze for demo. Dependency-graph badge, conflict demo scenario, ai-logs auto-write all working.

## Open questions

- Cross-chat hand-off (scenario 4 in spec 030): demo-only for the sprint, productionize later.
- Should the user be able to create new agent roles inside a chat? Decided: **No** for now (see ADR-007).

## Changelog

- 2026-05-24 — initial draft.
