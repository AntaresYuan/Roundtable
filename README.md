# Roundtable

[![CI](https://github.com/AntaresYuan/Roundtable/actions/workflows/ci.yml/badge.svg)](https://github.com/AntaresYuan/Roundtable/actions/workflows/ci.yml)

An IM-style multi-agent collaboration platform. Users chat with multiple Coding Agents in single or group rooms; an Orchestrator (PM) dispatches tasks, routes `@mentions`, tracks artifact dependencies, and surfaces hand-offs as first-class product objects.

## What makes this different

- **Group-chat semantics for agents** — `@mention` routing, per-agent artifact ownership, visible hand-offs, observable side-conversations
- **Artifact dependency graph** — agents declare what they depend on; downstream artifacts surface a "dependency changed" badge when upstream moves
- **HandoffCard** — every PM-to-agent and agent-to-agent transfer produces a structured, editable card (not opaque message-passing)
- **Skills-as-spec** — the same `skills/` directory that guides Claude Code in our repo also ships into product workspaces, so dev-time and run-time share one set of conventions

## Tech stack

Next.js 15 (App Router) · TypeScript · LangGraph.js · Vercel AI SDK · CopilotKit · tRPC · Drizzle + Postgres · e2b sandbox

## Quick links

| If you want to... | Start here |
|---|---|
| Onboard as a contributor (human or agent) | [`AGENTS.md`](./AGENTS.md) |
| Understand product surface | [`specs/000-overview.md`](./specs/000-overview.md) |
| Add a new Coding Agent adapter | [`skills/add-agent-adapter/SKILL.md`](./skills/add-agent-adapter/SKILL.md) |
| See how we collaborate with AI | [`rules/ai-collaboration.md`](./rules/ai-collaboration.md) |
| Read architectural decisions | [`ai-logs/decisions/`](./ai-logs/decisions/) |
| Operate / deploy / reset the demo | [`docs/operations.md`](./docs/operations.md) |

## Status

Pre-alpha. 3-week build sprint. See `specs/000-overview.md` for milestone gates.

## Quick Start

Prerequisites:

- Node.js 20+
- Corepack enabled
- Docker Desktop or a compatible Docker engine

Install dependencies and start the local backend services:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm setup
```

`pnpm setup` starts Postgres and Redis with Docker Compose, then runs the
Drizzle migrations and demo seed data.

Useful local commands:

```bash
corepack pnpm ui:dev             # Next.js app at localhost:3000 (/ and /gallery)
corepack pnpm dev:services       # start Postgres + Redis
corepack pnpm dev:services:mail  # also start Mailhog for email auth testing
corepack pnpm db:reset           # drop service volumes, restart, migrate, seed
corepack pnpm test
corepack pnpm typecheck
```

Copy `.env.example` to `.env` before running the full app stack.
