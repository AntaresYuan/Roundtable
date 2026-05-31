# Operations & deployment

Everything an operator (or a first-day contributor who didn't help build it) needs to bring Roundtable up locally, understand the moving parts, deploy it, and reset the demo.

Paired with [`docs/technical.md`](./technical.md) (Edwin's logical architecture doc, issue #32): that one explains *what the system is*, this one explains *how to run it*.

---

## 1. Local development

### Prerequisites

- **Node.js 20+** — `node --version` should report `v20.x` or `v24.x`. Newer LTS works.
- **Corepack enabled** — `corepack enable` once per machine; the repo pins `pnpm@9.0.0` via `packageManager`.
- **Docker Desktop** (or equivalent engine) — used by the local Postgres + Redis stack. Not required for `pnpm test`, which uses an in-process Postgres ([PGlite](https://github.com/electric-sql/pglite)).

### First-run

```bash
git clone https://github.com/AntaresYuan/Roundtable
cd Roundtable
corepack pnpm install --frozen-lockfile
cp .env.example .env       # then fill in keys you actually use
corepack pnpm setup        # docker-compose up -d + drizzle migrate + seed
```

`pnpm setup` is the all-in-one. If you'd rather drive each step:

```bash
corepack pnpm dev:services       # start Postgres + Redis (docker-compose)
corepack pnpm db:migrate         # apply Drizzle migrations
corepack pnpm db:seed            # insert minimal demo rows
```

### Day-to-day commands

| Command | What it does |
|---|---|
| `pnpm test` | full vitest suite (uses PGlite, no docker needed) |
| `pnpm typecheck` | `tsc --noEmit` strict mode |
| `pnpm lint` | eslint |
| `pnpm check:console` | blocks `console.log` outside debug paths |
| `pnpm spec:lint` | ensures specs are referenced from the AGENTS.md index |
| `pnpm orch:smoke` | runs the orchestrator through mock adapters end-to-end |
| `pnpm demo:restore` | wipes + re-inserts the demo dataset (see § 8) |
| `pnpm sandbox:reap` | one-shot e2b sandbox idle-reaper sweep |
| `pnpm checkpoints:cleanup` | GC LangGraph checkpoints older than `CHECKPOINT_TTL_DAYS` |

### Resetting the local stack

```bash
corepack pnpm db:reset      # docker volume drop + recreate + migrate + seed
```

---

## 2. Environment variables

Group | Variable | Required? | Default | Used by
---|---|---|---|---
**Database** | `DATABASE_URL` | prod | `postgres://roundtable:roundtable@localhost:5432/roundtable` | `src/db/client.ts`, `src/orchestrator/checkpointer.ts`, `scripts/db-migrate.mjs`
**Database** | `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | docker only | `roundtable` / `roundtable` / `roundtable` / `5432` | `docker-compose.yml`
**Database** | `REDIS_PORT` | docker only | `6379` | `docker-compose.yml`
**Email auth** | `AUTH_EMAIL_SERVER` | when sending verify emails | — | `src/server/auth.ts`
**Email auth** | `AUTH_EMAIL_FROM` | when sending verify emails | — | `src/server/auth.ts`
**Email auth** | `MAILHOG_SMTP_PORT` / `MAILHOG_UI_PORT` | local mail testing | `1025` / `8025` | `docker-compose.yml` (mail profile)
**LLM** | `ANTHROPIC_API_KEY` | for LLM-backed nodes (`llmIntake`, `llmPlanner`, `llmSelector`, `createAISDKHandoffModelClient`) | — | `src/orchestrator/llm/provider.ts`
**Sandboxing** | `E2B_API_KEY` | when serving live `web_app` previews | — | `src/lib/sandbox-provider-e2b.ts`
**Sandboxing** | `SANDBOX_URL_SIGNING_SECRET` | always (HMAC for iframe URLs) | — | `src/lib/sandbox.ts`
**Maintenance** | `CHECKPOINT_TTL_DAYS` | optional GC tuning | `30` | `scripts/cleanup-checkpoints.ts`
**Maintenance** | `DEMO_SEED_PATH` | override fixture path | `tests/fixtures/demo/seed.json` | `scripts/demo-restore.ts`
**Maintenance** | `ROUNDTABLE_RUN_CLAUDE_INTEGRATION` | opt-in live-CLI test | unset | `tests/adapters/claude-code/adapter.test.ts`
**Maintenance** | `ROUNDTABLE_CLAUDE_COMMAND` | override the `claude` binary path | `claude` | same test

Anything marked "required: prod" still has a useful local default; missing values throw at boot rather than silently misbehaving.

---

## 3. Postgres + Redis topology

Local stack lives in `docker-compose.yml`:

| Service | Image | Port | Volume |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `5432` | `postgres-data` |
| `redis` | `redis:7-alpine` | `6379` | `redis-data` |
| `mailhog` | `mailhog/mailhog:v1.0.1` | `1025` (SMTP) / `8025` (UI) | none (ephemeral) |

`mailhog` is behind the `--profile mail` flag — start it with `pnpm dev:services:mail`.

### Schema management

Source of truth: `src/db/schema.ts` (Drizzle). Migrations are generated SQL under `drizzle/` — **never edit a generated migration**; instead change the schema and run `corepack pnpm drizzle-kit generate` to add a new one.

The LangGraph checkpoint tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`, `checkpoint_migrations`) are **not** managed by Drizzle. The Postgres saver from `@langchain/langgraph-checkpoint-postgres` runs its own idempotent `setup()` on first use, so they appear automatically.

### Tests vs prod

`pnpm test` uses PGlite (in-process Postgres) so contributors don't need docker just to run the suite. Production and the local app both connect via `postgres-js` to a real Postgres process. The Drizzle queries are identical against both — that's the point of PGlite.

---

## 4. e2b sandbox (`web_app` live preview)

Code: `src/lib/sandbox.ts`, `src/lib/sandbox-provider.ts`, `src/lib/sandbox-provider-e2b.ts`, `src/lib/sandbox-reaper.ts`.
Design: [`ADR-005`](../ai-logs/decisions/ADR-005-e2b-sandbox-provisioning.md).

### Quota

`SandboxManager` enforces a **per-chat budget** (`DEFAULT_PER_CHAT_BUDGET = 3`). Over budget, `provision()` returns `{ ok: false, error: 'quota_exceeded' }` — the renderer is expected to degrade to the file-tree fallback (spec 040 § Hybrid rendering policy).

### URL signing

Every `provision()` returns an iframe URL signed with HMAC-SHA256 (`SANDBOX_URL_SIGNING_SECRET`) and expires at `DEFAULT_URL_TTL_MS` (30 min). Verify on the proxy / route side with `verifySandboxUrl(url, secret)` — uses `timingSafeEqual` to avoid signature timing leaks.

### Idle reaper

Sandboxes idle for `DEFAULT_IDLE_TIMEOUT_MS` (10 min) get destroyed.

- **Long-running server**: call `startSandboxReaper({ manager })` in process; it sweeps every 60s.
- **Cron / ops rescue**: `pnpm sandbox:reap` runs one sweep and exits. Note: only sees this process's in-memory registry; the in-process reaper is the load-bearing one.

### Failure modes

- `E2B_API_KEY` unset → `provision()` throws → returned as `{ ok: false, error: 'provider_failed' }`.
- e2b quota / outage → same path.
- Bad input (no files / empty entrypoint) → `{ ok: false, error: 'invalid_input' }`.

In every failure case the UI falls back to the file-tree view — the user always sees *something*.

---

## 5. Workspace storage layout

Each chat owns a directory tree on the host where adapter processes run:

```
workspaces/<chatId>/
├── <user-provided files>             # what the agent created / edited
└── .roundtable/
    └── sessions/
        └── <adapterId>/              # adapter-private state (auth, session db, etc.)
            └── ...                   # e.g. Claude Code's CLAUDE_CONFIG_DIR
```

Rules enforced by the adapter protocol (spec 020):

- All CLI subprocesses are spawned with `cwd = workspaces/<chatId>/`.
- Adapter sessions write their config under `.roundtable/sessions/<adapterId>/` — **per-chat auth isolation** is what keeps a Claude Code session for chat A from leaking into chat B.
- Adapters MUST NOT write outside their `cwd`. (Spec 020 § Workspace isolation hard requirement.)

The base `workspaces/` location is conventional — set the parent dir via the `workspaceResolver()` argument when wiring `runOrchestrator()`.

---

## 6. Log destinations

Structured logging goes through `src/server/logger.ts` (`logger.event(name, payload)`). The default server context wires a noop logger; production should swap in a real sink (e.g. pino, datadog, etc.).

Append-only telemetry files (created on first write):

| File | Producer | Use |
|---|---|---|
| `ai-logs/handoffs.jsonl` | `fileHandoffLog()` in the orchestrator dispatch path | one line per emitted `HandoffCard` — feeds review + spec drift detection |
| `ai-logs/selector-decisions.jsonl` | `fileSelectorTelemetry()` from `runSelector()` | one line per group-chat speaker pick (chatId, confidence, fallback triggered) |
| `ai-logs/prompt-history/*.md` | committed by hand when prompts change | snapshot of the prompt at the time of a commit |

Child-process stderr (Claude Code adapter) is captured in a 64 KB ring buffer (`stderrSnapshot()` on the `CliProcess`). Not persisted to disk — surface it via logger when an adapter session errors.

---

## 7. Deployment (Railway recipe)

> **Status:** documented from Railway's standard docs; *not yet end-to-end verified by this team*. The first person to deploy should refine this section in the same PR.

Railway is picked for v1 because it provisions Postgres + a Node runtime + secrets in one project, and we only need a single long-running process (the Next.js app + orchestrator).

### Provisioning

1. Create a new **Railway project**.
2. Add a **Postgres** plugin → grab the `DATABASE_URL` it generates.
3. (Optional) Add a **Redis** plugin if/when you wire the dispatch queue or session store. The app boots without it.
4. Create a **GitHub-linked service** pointing at this repo, `main` branch.

### Service config

| Setting | Value |
|---|---|
| Build command | `corepack enable && corepack pnpm install --frozen-lockfile && corepack pnpm db:migrate && corepack pnpm build` |
| Start command | `corepack pnpm start` |
| Health check | `/api/health` (add when scaffolded; until then leave default) |

### Required env vars on the Railway service

- `DATABASE_URL` (from the Postgres plugin)
- `ANTHROPIC_API_KEY`
- `E2B_API_KEY`
- `SANDBOX_URL_SIGNING_SECRET` (generate with `openssl rand -hex 32`)
- `AUTH_EMAIL_SERVER`, `AUTH_EMAIL_FROM` (if using email auth)
- `NEXTAUTH_SECRET` (when the Next.js auth route lands)

### Scheduled jobs

Schedule these as Railway cron tasks (or external runners):

| Frequency | Command | Purpose |
|---|---|---|
| daily | `pnpm checkpoints:cleanup` | GC LangGraph checkpoints older than 30 days |
| every 5 min | inline `startSandboxReaper()` in the server | kill idle sandboxes — keep the in-process version, not the CLI |

### After-deploy smoke checklist

- [ ] `curl https://<service>/api/health` → 200
- [ ] hit `pnpm orch:smoke` against the deployed `DATABASE_URL` (set the env locally) → exits 0
- [ ] log into the demo account; one chat exists from `pnpm demo:restore` (see § 8)

---

## 8. Demo reset

`pnpm demo:restore` re-creates the demo dataset from a JSON fixture. Idempotent — run as often as you want; each call leaves the DB in the same final state.

- Fixture: [`tests/fixtures/demo/seed.json`](../tests/fixtures/demo/seed.json) — 1 user, 1 chat, 3 messages, 2 artifacts (one with a `references` dep), 1 handoff card, 1 pinned message.
- Override the fixture path with `DEMO_SEED_PATH=path/to/other.json pnpm demo:restore`.
- Reset semantics: deletes the fixture's `chats.id` and `users.id` rows first (which cascades through messages / artifacts / handoffs / pinned via `ON DELETE CASCADE`), then inserts the fixture cleanly.

Use this before the demo to guarantee a known-good starting state, and after any wild local poking to get back to baseline.

---

## 9. Backup & disaster recovery

For Railway:

```bash
# nightly backup
pg_dump $DATABASE_URL > backups/roundtable-$(date +%F).sql

# restore
psql $DATABASE_URL < backups/roundtable-2026-05-31.sql
```

For a destroyed environment, rebuilding is the same as first-deploy plus restoring the dump. Workspaces under `workspaces/<chatId>/` are not currently backed up — agent file edits are reproducible from the artifact event stream + `handoffs.jsonl`, so persistent backup is deliberately deferred.

---

## 10. Where to look when things break

| Symptom | First place to look |
|---|---|
| Orchestrator stuck mid-run | `getState({ thread_id })` against the Postgres checkpointer; resume with `resumeOrchestrator()` |
| `web_app` artifact shows the file tree, not a live preview | check `E2B_API_KEY`; look for `provider_failed` / `quota_exceeded` in logs |
| Pinned messages not appearing in HandoffCards | check the HandoffCard generator calls `loadPinnedForHandoff()`; see #44 follow-up |
| `pnpm test` hangs on migrations | wipe the test PGlite — it's in-memory per process, but a stuck process can pin file handles. Restart vitest. |
| Spec lint fails | a new spec wasn't linked from `AGENTS.md` § "Where to start" — add a row |
| Pre-commit hook fails | `pnpm typecheck && pnpm lint && pnpm check:console` to see which gate failed |
