# AI-Friendly Repository Layout

This document defines how Roundtable should organize repository-level documentation, rules, skills, and AI collaboration logs so that humans and coding agents can enter the project quickly and work with traceable context.

The layout is based on the Roundtable brainstorm notes from May 24, 2026, especially the "Agent 友好仓库 + AI 协作规范" section.

## Goals

- Make the repository immediately readable by coding agents such as Claude Code, Codex, Cursor, and custom Roundtable agents.
- Keep product and technical decisions traceable through specs and AI collaboration records.
- Make reusable agent workflows first-class assets instead of hidden chat history.
- Use the same conventions for the Roundtable codebase and for user workspaces created by Roundtable.

## Repository Skeleton

```text
roundtable/
├── AGENTS.md
├── CLAUDE.md
├── .cursor/
│   └── rules/
│       ├── 00-general.mdc
│       ├── typescript.mdc
│       └── nextjs.mdc
├── specs/
│   ├── 000-overview.md
│   ├── 010-orchestrator.md
│   ├── 020-adapter-protocol.md
│   ├── 030-handoff-card.md
│   ├── 040-artifact-types.md
│   ├── 050-group-chat-routing.md
│   └── 060-dependency-graph.md
├── skills/
│   ├── add-agent-adapter/
│   │   ├── SKILL.md
│   │   └── template/
│   ├── write-orchestrator-prompt/
│   ├── debug-stream-json/
│   ├── generate-handoff-card/
│   └── release-checklist/
├── rules/
│   ├── ai-collaboration.md
│   ├── commit-message.md
│   ├── pr-checklist.md
│   └── code-review.md
├── ai-logs/
│   ├── decisions/
│   ├── handoffs.jsonl
│   ├── incidents.md
│   └── prompt-history/
├── examples/
│   └── adapter-template/
└── src/
```

## Seven Pillars

### 1. `AGENTS.md`: Agent Entry Point

`AGENTS.md` is the first file any coding agent should read. Keep it short, operational, and link-heavy.

Recommended sections:

- What Roundtable is: an IM-style multi-agent collaboration platform where an Orchestrator dispatches work to coding agents in single or group rooms.
- Tech stack: Next.js 15, TypeScript, LangGraph.js, Vercel AI SDK, CopilotKit, tRPC, Drizzle/Postgres, and e2b sandbox.
- Where to start by intent:
  - Add a coding agent: `skills/add-agent-adapter/SKILL.md`
  - Change Orchestrator behavior: `specs/010-orchestrator.md`
  - Modify handoff mechanics: `specs/030-handoff-card.md`
  - Debug Claude Code streaming: `skills/debug-stream-json/SKILL.md`
  - Understand artifact rendering: `specs/040-artifact-types.md`
- Hard rules:
  - Agent code paths must emit structured events instead of unstructured logs.
  - Every PR should link a `specs/` document or add an `ai-logs/decisions/` entry.
  - Agent errors must surface as explicit `error` events.
  - Do not forward full chat history by default; pass context through `HandoffCard`.
- Run, test, and lint commands.
- Naming and project conventions.

`AGENTS.md` should not duplicate the README. The README explains the project to people; `AGENTS.md` routes agents to the right operating context.

### 2. `specs/`: Product and Technical Specs

Specs are the source of truth for product behavior and cross-module contracts. Use numbered files and never renumber existing specs.

Core specs to create first:

- `000-overview.md`: product frame, core concepts, architecture map.
- `010-orchestrator.md`: Intake, Clarify, Plan, Dispatch, Monitor, Aggregate.
- `020-adapter-protocol.md`: `AgentAdapter`, `AgentSession`, and `AgentEvent` contracts.
- `030-handoff-card.md`: handoff data model, generation rules, UI behavior, token budget.
- `040-artifact-types.md`: artifact ownership, versions, preview modes, diff rules.
- `050-group-chat-routing.md`: `@mention` routing, selector behavior, recursion limit.
- `060-dependency-graph.md`: dependency declaration, broadcast rules, badge behavior, mini graph.

Use this spec template:

```markdown
# Spec NNN: Title

## Goal

What this spec defines.

## Non-goals

- What this spec intentionally does not define.

## Background

Why this behavior or contract exists.

## Design

Describe the state machine, data shape, user flow, or interface.

## Acceptance Criteria

- [ ] Observable behavior that must pass.
- [ ] Edge cases that must be handled.

## Open Questions

- Question, current owner, and expected decision date.

## Changelog

- YYYY-MM-DD: Initial draft.
```

Specs should be short enough to scan. For the first implementation pass, aim for 200-400 words per spec, then expand only when code or product behavior needs more precision.

### 3. `skills/`: Reusable Agent Workflows

Skills package recurring work as `SKILL.md` plus optional resources or templates. They should be usable by development agents and, eventually, by Roundtable runtime agents.

Minimum useful skills:

- `add-agent-adapter`: add a new coding agent adapter.
- `write-orchestrator-prompt`: update PM-style Orchestrator prompts.
- `debug-stream-json`: debug Claude Code or Codex streaming protocols.
- `generate-handoff-card`: create a structured context handoff.
- `release-checklist`: verify docs, tests, logs, and demos before release.

Example `skills/add-agent-adapter/SKILL.md` shape:

```markdown
---
name: add-agent-adapter
description: Add a new Coding Agent adapter to Roundtable.
---

# Skill: Add Agent Adapter

Use this when integrating a new Coding Agent such as Cursor, Aider, OpenCode, Codex, Claude Code, or a custom CLI.

## Steps

1. Create `src/adapters/<id>/`.
2. Implement the `AgentAdapter` interface from `specs/020-adapter-protocol.md`.
3. Map vendor events into canonical `AgentEvent` values.
4. Register the adapter in `src/adapters/registry.ts`.
5. Add a spec entry in `specs/agents/<id>.md`.
6. Add tests in `tests/adapters/<id>.test.ts`.
7. Update `AGENTS.md` with capability and usage notes.

## Gotchas

- Consume both stdout and stderr for CLI adapters to avoid deadlocks.
- Force headless or print mode for vendor CLIs when available.
- Keep authentication and workspace isolation explicit.
```

### 4. `rules/`: Team Collaboration Rules

Rules describe how the team works. They should be practical and enforceable, not aspirational.

`rules/ai-collaboration.md` is the most important file in this folder. It should define:

- When to ask AI vs when to ask the team.
- What must be recorded:
  - architecture decisions in `ai-logs/decisions/ADR-NNN.md`
  - unexpected AI behavior in `ai-logs/incidents.md`
  - reusable prompts in `ai-logs/prompt-history/`
- Prompt hygiene:
  - never paste secrets or API keys
  - use repo-relative paths
  - save important prompts in version control
- Pairing protocol:
  - human driver owns final code
  - AI can propose implementation, tests, and documentation
  - architectural decisions require human review
- Pre-commit expectations:
  - run lint and tests
  - update relevant specs when changing interfaces
  - update `AGENTS.md` when changing repository structure

### 5. `ai-logs/`: Living AI Collaboration Archive

This folder demonstrates how the team uses AI and what was learned from it.

Use `ai-logs/decisions/` for ADR-style records:

```text
ai-logs/decisions/
├── ADR-001-choose-langgraph-over-autogen.md
├── ADR-002-claude-code-cli-vs-api.md
├── ADR-003-handoff-card-format.md
└── ADR-004-pm-agent-creation-policy.md
```

Each ADR should include:

- Status and date.
- Context and options considered.
- Decision and rationale.
- AI assistance used, with links to prompt snapshots when useful.
- Consequences and migration notes.

Use `ai-logs/handoffs.jsonl` for runtime handoff records:

```jsonl
{"ts":"2026-05-24T09:30:00Z","from":"@frontend","to":"@backend","card_id":"handoff_123","user_intent":"Build login flow","summary":"Frontend expects POST /api/login with email and password."}
```

Use `ai-logs/incidents.md` to record wrong or risky AI behavior and the guard added afterward. This makes failure part of the engineering system instead of hidden cleanup work.

### 6. `.cursor/rules/` and `CLAUDE.md`: Tool-Specific Guidance

Keep general rules in shared files and tool-specific quirks in their own files.

- `CLAUDE.md`: Claude Code conventions, command expectations, tool permissions, and project-specific workflow notes.
- `.cursor/rules/00-general.mdc`: shared Cursor behavior.
- `.cursor/rules/typescript.mdc`: TypeScript conventions.
- `.cursor/rules/nextjs.mdc`: Next.js App Router conventions.

Tool-specific files should point back to `AGENTS.md`, `specs/`, and `rules/` instead of redefining the whole project.

### 7. `examples/`: Copyable Reference Implementations

Examples should be boring, correct, and easy to copy. The first example should be `examples/adapter-template/`, including:

- adapter class skeleton
- event mapping fixture
- tests
- README explaining how to turn the template into a real adapter

Examples are especially useful for agent work because they reduce ambiguity and prevent agents from inventing a new local pattern every time.

## Runtime Alignment

Roundtable should use the same AI-friendly structure in user workspaces that it uses in its own repository.

When a Roundtable workspace is initialized, the product should be able to:

- generate a workspace-specific `AGENTS.md` with current agents, capabilities, and task context
- create `ai-logs/handoffs.jsonl`
- copy or link relevant `skills/` into the workspace for agent discovery
- record handoff cards and important prompts as durable artifacts

This gives Roundtable a strong product story: the development repository is agent-friendly, and every user project created by Roundtable becomes agent-friendly by default.

## Implementation Order

For the first week of implementation, create the structure early even if some files start as templates.

1. Add `AGENTS.md`, `rules/ai-collaboration.md`, and `specs/000-overview.md`.
2. Add specs for Orchestrator, adapter protocol, handoff card, artifact types, group routing, and dependency graph.
3. Add the first three skills: `add-agent-adapter`, `write-orchestrator-prompt`, and `debug-stream-json`.
4. Add `ai-logs/decisions/ADR-001-choose-langgraph.md` and `ai-logs/incidents.md`.
5. Add `examples/adapter-template/`.
6. Wire PR review expectations to require either a linked spec or a decision log update.

## Acceptance Criteria

- A new human contributor can find the right spec or rule in under one minute.
- A coding agent can read `AGENTS.md` and know where to start for common tasks.
- Every major architecture change has a spec or ADR.
- Every reusable prompt or agent workflow has a stable file path.
- Agent handoffs can be audited through `ai-logs/handoffs.jsonl`.
- Product runtime workspaces can reuse the same structure without inventing a second convention.
