# Spec 000: Roundtable — Product & System Overview

## Goal

Roundtable is a consumer-friendly vibe coding workbench for non-programmers and AI-native builders. It turns coding CLIs such as Claude Code, Codex, Gemini CLI, OpenCode, and user-built agents into role-based teammates coordinated by an Orchestrator.

The product should feel more approachable than a terminal-only coding agent and more maintainable than one-shot demo generators.

## Non-goals

- Not a generic LLM chat client. Roundtable is opinionated about coding workflows.
- Not a workflow builder (no node-graph editor). Coordination emerges from chat + Orchestrator behavior, not from a canvas.
- Not a model-routing service. Agents bring their own model; we orchestrate them.
- Not a one-shot website generator. The product must preserve files, diffs, specs, reviews, and follow-up tasks so projects can be maintained after the first demo.

## Target users

Roundtable is designed for people who want to build with AI but do not want to operate like professional software engineers from day one:

- non-code founders validating product ideas
- designers and operators building internal tools
- students or creators learning by making
- experienced vibe coders who want better orchestration, review, and maintenance than a single CLI can provide

The user should be able to understand what is happening without reading raw terminal output. The system should expose agent decisions as task cards, artifacts, diffs, previews, review comments, and next-step buttons.

## Product stance

| Compared with | Roundtable stance |
|---|---|
| Claude Code | Claude Code is powerful but terminal-first. Roundtable wraps similar capabilities in a visible workflow with task ownership, previews, review, and user intervention. |
| Lovable / v0 / Bolt | These tools are fast at first demos. Roundtable prioritizes maintainable projects: specs, file history, reviews, dependency awareness, and repeatable agent workflows. |
| Generic multi-agent demos | Roundtable is not just parallel chat bubbles. Agents operate against a real workspace through a unified adapter protocol and produce auditable artifacts. |

## Differentiation axis

**A terminal brain for multiple coding CLIs.** The Orchestrator can assign different roles to different CLIs:

- architect: system design, contracts, tradeoffs
- planner: task breakdown, acceptance criteria, sequencing
- implementer: file edits and scaffold generation
- reviewer: critique, tests, security, maintainability
- fixer: targeted bug and CI repair

The user sees a friendly group-work surface while the system controls real CLI tools underneath.

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
| Customizable workflows | 090 |
| Memory layers (chat / workbench / user) | 100 |

## Tech stack & why

- **Next.js 15 + App Router** — server components for fast initial paint; streaming responses for agent output.
- **LangGraph.js** — TS-native orchestration with explicit checkpoint + `interrupt()` for HITL (see ADR-001).
- **Vercel AI SDK** — uniform LLM provider abstraction; powers Custom Agent runtime.
- **CopilotKit** — generative UI primitives (clarify cards, todo lists, quick actions).
- **tRPC + Drizzle + Postgres** — typed end-to-end; SSE for streaming.
- **e2b sandbox** — live previews for `web_app` artifacts (long-tail artifacts render statically).

## Milestone gates

- **Day 5 (D5)** — single-chat happy path with one adapter (Claude Code).
- **Day 10 (D10)** — group chat with two adapters, Orchestrator 7-stage loop mocked end-to-end.
- **Day 14 (D14)** — HandoffCard live; artifact dispatcher renders ≥ 4 kinds; OpenCode adapter live.
- **Day 19 (D19)** — freeze for demo. Dependency-graph badge, conflict demo scenario, ai-logs auto-write all working.

## Open questions

- Cross-chat hand-off (scenario 4 in spec 030): demo-only for the sprint, productionize later.
- Should the user be able to create new agent roles inside a chat? Decided: **No** for now (see ADR-007).
- Which second CLI proves the adapter abstraction best for the demo: OpenCode for HTTP/SSE simplicity, or Codex for strategic parity with Claude Code? Current bias: OpenCode first, Codex as demo adapter after protocol stabilizes.

## Changelog

- 2026-06-04 — added Memory layers (spec 100) to the pillars table.
- 2026-05-25 — reframed as consumer-friendly multi-CLI vibe coding workbench.
- 2026-05-24 — initial draft.
