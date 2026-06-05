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

## User-visible boundary

Roundtable's main chat is a collaboration surface, not a terminal mirror. The
main chat should show only five object families:

1. **Plan** — what the Orchestrator intends to do.
2. **Progress** — which agents are working, blocked, or done.
3. **Artifact** — files, diffs, previews, review comments, and dependency badges.
4. **Decision** — gates, failure recovery, approval, retry, reassign, and edit-handoff
   choices that need the user or were automatically handled by policy.
5. **Result** — the aggregate summary and next-step actions.

Everything else must be mapped into one of four visibility tiers:

| Tier | Product rule | UI treatment |
|---|---|---|
| Main-chat card | The user needs to understand or act now. | Inline card or bubble. |
| Collapsed details | Useful for trust, audit, or intervention, but not the main story. | Expandable section inside the related card. |
| Side panel | Long-running context that helps inspect work but should not interrupt chat flow. | Artifact, dependency, handoff, or workflow panel. |
| Debug-only log | Vendor/runtime machinery. Useful for developers, noisy for users. | Hidden behind debug mode or logs; never appears inline by default. |

### Visibility mapping

| Object or event | Tier | Notes |
|---|---|---|
| User message | Main-chat card | Always visible as the user's source intent. |
| Orchestrator plan | Main-chat card | Summarized as tasks; internal decomposition details stay collapsed. |
| Todo/progress updates | Main-chat card | One live card per dispatch turn; updates in place. |
| Final agent reply | Main-chat card | Show the useful outcome, not every intermediate token. |
| Artifact created or version bumped | Main-chat card | Inline summary plus link to preview/diff panel. |
| Diff / preview | Side panel | Main chat links to it; detailed inspection happens off the primary transcript. |
| Review comments | Main-chat card when blocking; side panel otherwise | Blocking comments are decisions; non-blocking comments are artifact detail. |
| Dependency-changed badge | Main-chat card on affected artifact | Dependency graph internals remain side-panel/debug. |
| Gate pending | Main-chat card | The run is paused; show approve/request-changes/edit choices clearly. |
| Failure recovery | Main-chat card | Show agent, task, concise failure summary, retry/reassign/edit/stop actions. |
| Autonomy decision | Collapsed details | Main card may say "Auto-retried once"; full policy/audit goes in details. |
| HandoffCard | Collapsed details by default; main-chat card when editable before dispatch | Users may inspect/edit carried context; raw prompt construction is not inline. |
| HandoffCard context audit | Collapsed details or side panel | Show source names and inclusion decisions, not full raw history. |
| Side conversation | Collapsed details | Render as a compact chip; expandable with interject action. |
| Tool use / tool result | Collapsed details | Show tool name and status; raw inputs/outputs are debug unless user-facing. |
| Raw terminal / stream-json | Debug-only log | Never leak into normal chat. |
| `thinking_delta` | Debug-only log by default | May be a privacy setting later; hidden in v1. |
| Recoverable adapter error | Collapsed details unless it blocks | If policy auto-retries, show a short audit note; if blocked, show FailureRecovery. |
| Non-recoverable adapter error | Main-chat card | Must become FailureRecovery, not a stack trace. |
| Aggregate summary | Main-chat card | Four lines or less, with next actions and artifact links. |

### Boundary rules

- A user decision point is always visible: approve, request changes, retry, reassign,
  edit handoff, stop, deploy, tool-access expansion, auth/secrets changes, and large
  deletion.
- Safe automatic actions are visible as audit chips, not as interruptions. The user can
  expand to see the `AutonomyDecision` reason and policy level.
- Raw logs never become product copy. They may be attached as `debugDetails` on the
  related card or stored in developer logs.
- Internal graphs and selectors explain outcomes only when useful: "Dependency changed"
  is visible; topological sorting, selector runner-up scoring, and retry-loop plumbing are
  debug or collapsed details.
- Agent-visible context is not the same as user-visible context. Agents receive bounded
  `HandoffCard` context; users see the card summary and source audit.

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

- 2026-06-05 — added the user-visible orchestration boundary and visibility tiers.
- 2026-06-04 — added Memory layers (spec 100) to the pillars table.
- 2026-05-25 — reframed as consumer-friendly multi-CLI vibe coding workbench.
- 2026-05-24 — initial draft.
