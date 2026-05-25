# Spec 070: Skills System (Build + Runtime)

## Goal

Use the Anthropic Skills format for both:

1. **Build time** — guiding contributing agents (Claude Code, Cursor) inside this repo.
2. **Runtime** — the same skills get copied / symlinked into user workspaces so the platform's Coding Agents pick them up automatically.

One source of truth for "how this team works" and "how the product's agents should work."

## Non-goals

- Not Anthropic's Skills SDK. We use only the *file format* — no Anthropic-only runtime.
- Not a skill marketplace. v1 ships built-in skills only.

## Format

Each skill is a directory with a `SKILL.md` file. The frontmatter:

```yaml
---
name: <kebab-case>
description: >-
  When to trigger. Be explicit — list user phrases that should fire this skill.
---
```

The body is plain Markdown. Optional resources (templates, fixtures) live alongside `SKILL.md` in the same directory.

## Build-time skills (this repo's contributors use these)

| Skill | Purpose |
|---|---|
| `add-agent-adapter` | Procedure for integrating a new Coding Agent. |
| `write-orchestrator-prompt` | Editing the PM agent's prompt safely. |
| `debug-stream-json` | Troubleshooting the Claude Code CLI bridge. |
| `release-checklist` | Pre-tag review. |

## Runtime skills (the product's Coding Agents discover these)

| Skill | Purpose |
|---|---|
| `generate-handoff-card` | Template a HandoffCard from current state. |
| `declare-dependency` | Show the agent how to emit a `<dependencies>` block. |

## Workspace initialization

When the product creates a workspace at `workspaces/<chatId>/`, the platform:

1. Writes a chat-scoped `AGENTS.md` populated with: who is in the group, their roles, the current task brief.
2. Symlinks (or copies) `skills/runtime/*` into `workspaces/<chatId>/.claude/skills/`.
3. Initializes `ai-logs/handoffs.jsonl` for that workspace.
4. Copies the relevant `rules/` subset (commit format, no-attribution rule, etc.).

So every chat is itself an agent-friendly project that Claude Code / OpenCode can pick up.

## Cross-cutting story

> The same skills that guide our team to add a feature also guide the product's runtime agents to do their job. Dev-time and run-time share one set of conventions, so when the team learns something new, the product learns it the same day.

## Acceptance criteria

- [ ] All 4 build-time skills exist with valid frontmatter and at least one acceptance case.
- [ ] Workspace init script symlinks runtime skills correctly on macOS and Linux.
- [ ] Claude Code in a freshly initialized workspace auto-discovers the runtime skills (verified by smoke test).

## Open questions

- Should users be able to author skills inside Roundtable? v1: no — skills are platform-built.

## Changelog

- 2026-05-24 — initial draft.
