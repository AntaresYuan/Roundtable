# Phase 3 — Wire the frontend to live data (fixtures → real)

> **Status: P3.1 done & verified live** (branch `antares/phase3-plan`). The tRPC client,
> `/api/trpc` route, Providers, and a dev login are wired — `chats.list` / `chats.create`
> confirmed end-to-end against Postgres via the `/dev` probe. Remaining: **P3.2** (read-path
> into the real UI; the product UI still renders `src/ui/lib/rt.js` fixtures until then),
> **P3.4** live stream (blocked on the @Evanlin stream ticket), and the **email adapter**
> (@Peitong ticket). The `/dev` probe + dev-credentials login are temporary scaffolding.

## Diagnosis — three seams are open

Backend surface verified (see `src/server/routers/*`, `src/server/trpc.ts` — transformer is
**superjson**). What's missing for the UI to consume real data:

1. **No tRPC client in the frontend** — no `@trpc/client` / `@tanstack/react-query`, no provider.
2. **No `/app/api/trpc/[trpc]` route handler** — the tRPC server isn't exposed over HTTP.
3. **The event stream is a stub** — `src/server/stream.ts` `createAgentEventStream()` yields one
   fake `text_delta` and is **not wired to the orchestrator**. This is the load-bearing blocker.

Everything reads behind `protectedProcedure` → the frontend needs a NextAuth session.

## Lane split

| Area | Owner |
|---|---|
| tRPC client + `/api/trpc` route + provider + session, read-path swap, stream consumer | **UI (AntaresYuan)** |
| `createAgentEventStream` → real orchestrator events (the blocker), `runOrchestrator` trigger | **Orchestrator (Evanlin)** |
| `/api/trpc` ↔ server context / auth session plumbing | server (Peitong) — thin seam, coordinate |

## Staged plan

| Stage | What | Owner | Depends on |
|---|---|---|---|
| **P3.1 — Pipe** | `@trpc/client` + `@trpc/react-query` + `@tanstack/react-query`; `src/app/api/trpc/[trpc]/route.ts` (fetch adapter + `getServerSession`); `src/ui/lib/trpc.ts` (`createTRPCReact<AppRouter>`, superjson); `<TRPCProvider>` + `<SessionProvider>` in the root layout. Smoke: `chats.list` renders. | UI | — |
| **P3.2 — Read path** | Swap static fixtures for live queries: `RT.AGENTS`→`agents.list`, `RT.ARTIFACTS`→`artifacts.listByChat`, `RT.HANDOFF`→`handoffs.listByChat`, ConversationRail tasks→`chats.list`. Keep fixtures as the fallback/empty-state. | UI | P3.1 |
| **P3.3 — Send + run** | `messages.create` from the composer; a mutation that triggers `runOrchestrator(chatId, userMessage)`. | UI + **needs a backend trigger** | P3.1, Evan |
| **P3.4 — Live stream** | Consume the `messages.stream` subscription in the chat thread (drives the roundtable scene state from real `AgentEvent`s). **Blocked on the Evan ticket below.** | UI consumer + **Evan** | P3.3 + Evan |
| **P3.5 — Contract reconcile** | Resolve mismatches (below). | UI + contracts | rolling |

**Doable now without Evan:** P3.1 + P3.2 (the pipe + the static read-path). The scene can't go
live until P3.4, but agents / artifacts / handoffs / chat list can be real immediately.

## 🎟️ Ticket for @Evanlin — wire `createAgentEventStream` to the orchestrator

`src/server/stream.ts:3` is a stub. For P3.4 the frontend needs:

- `messages.stream({ chatId })` (already a tRPC subscription at `src/server/routers/messages.ts:51`)
  to yield the **real `AgentEvent`s** produced by an orchestrator run for that chat — not a mock.
- A way to **start a run** for a chat from a user message (e.g., a `messages.send` / `chats.run`
  mutation that calls `runOrchestrator({ chatId, userMessage }, deps)` and pipes its node/adapter
  events into the same stream the subscription reads).
- Decision needed (orchestrator owner's call): how the in-process LangGraph run publishes events to
  the subscription — in-memory per-chat `EventEmitter`/async queue (simplest, single-process dev),
  Redis pub/sub (multi-process), or checkpoint polling. The frontend only needs: *one async iterable
  of `AgentEvent` per chat, starting when a run starts.*
- Events the UI consumes (already typed, `src/contracts/event.ts`): `thinking_delta`, `text_delta`,
  `tool_use`/`tool_result`, `file_change`, `artifact`, `declare_dependency`, `done`, `error`.

Until this lands, P3.1–P3.2 give real static data; the roundtable scene stays fixture-driven.

## 🎟️ Ticket for @Peitong (server/auth) — NextAuth adapter for email sign-in

`authOptions` (`src/server/auth.ts`) uses `EmailProvider` (magic link), which **requires a
NextAuth adapter** to persist verification tokens — not configured, so email sign-in throws
`EMAIL_REQUIRES_ADAPTER_ERROR`. Needed for real email login:

- A NextAuth adapter (e.g. `@auth/drizzle-adapter`) wired to the Drizzle db.
- Its tables — `accounts`, `sessions`, `verification_tokens` (schema currently has `users`
  only) + a migration.
- A real `NEXTAUTH_SECRET` (the `.env` value is a placeholder).

**Interim (already in place):** local dev uses an email-only `CredentialsProvider`
(`id: 'dev'`, gated to non-production) so the app is usable now; prod still points at
`EmailProvider`. Wire the adapter before relying on prod email login, then drop the dev shortcut.

## Contract reconciliation (P3.5)

- **Artifact `kind`**: server enum has 11 (`code/file/diff/web_app/markdown/mermaid/html/spec/doc/preview/note`,
  `src/db/schema.ts`); the UI `ArtifactRenderer` handles `file/diff/preview/doc/note`. Add renderers
  for `code/web_app/markdown/mermaid/html/spec` (or map them) before live artifacts of those kinds appear.
- **No `chatId` in the UI yet**: fixtures are global; live data is per-chat. The frontend needs a
  "current chat" (pick/create via `chats.list`/`chats.create`) threading `chatId` into queries.
- **`RT.SCRIPT` timeline → real messages**: the scripted scene clock must be replaced by the live
  `messages.list` + `messages.stream` sequence. The roundtable scene's `sceneAt(clock)` becomes
  "derive scene from the live message/event log."
- **`RT.PLAN` / workflow run state**: no procedure returns these yet; they live in orchestrator
  state. Expose via the run (ties to the Evan ticket + the `WorkflowRun` contract, spec 090).

## Verification note

P3.1's live smoke (`chats.list` returning rows) needs Postgres up (`pnpm setup`) + a signed-in user.
Without that, P3.1 is only compile/build-verifiable; full live verification waits on local infra.
