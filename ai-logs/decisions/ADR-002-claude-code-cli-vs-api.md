# ADR-002: Claude Code via CLI subprocess, not direct Anthropic API

## Status

Accepted (2026-05-23)

## Context

The Claude Code adapter is our flagship demo Agent. Two integration paths exist:

1. **Spawn the `claude` CLI as a subprocess** and parse its `stream-json` output.
2. **Call the Anthropic Messages API directly** and re-implement file edits / tool use ourselves.

## Decision

CLI subprocess via `claude -p --output-format stream-json --input-format stream-json`.

## Why

- **Behavior parity.** Users who already use Claude Code expect the same conventions (Read/Edit/Write tools, session resume, MCP discovery). Re-implementing them is weeks of work and will diverge.
- **Skill discovery for free.** Claude Code auto-discovers `skills/` in the working directory. Our workspace-init pipeline gives every chat its own skills folder; CLI picks them up with zero extra plumbing.
- **MCP support for free.** Claude Code's MCP integration is mature; our adapter just forwards the user's MCP server config into the subprocess env.
- **Session resume** via `--resume <id>` is solved upstream — we shouldn't reinvent it.

## Trade-offs accepted

- **Stdio bridge bugs** are notorious (see `skills/debug-stream-json/SKILL.md`). We mitigate with a recorded-fixture conformance test suite.
- **Process-per-session** has a startup cost (~200–500 ms). Tolerable for our throughput; revisit if we ever need high QPS.
- **CLI version skew** — we pin the version in `package.json` and document upgrade procedure in the release checklist.

## AI assistance

- Claude Code itself drafted the initial mapping table (Claude `stream-json` events → our `AgentEvent`). See `ai-logs/prompt-history/2026-05-23-claude-event-mapping.md`.
- We cross-checked with the `claude-code-router` open-source project to find known stdio pitfalls.

## Consequences

- Hard dependency on the `claude` binary in dev and prod environments. Provision in CI.
- Our adapter conformance suite must replay recorded sessions; live LLM calls are forbidden in tests.
- If Anthropic changes the `stream-json` schema, we ship a version-pinned adapter.
