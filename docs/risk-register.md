# Risk Register & Plan B

Competition-day risk table (issue #21). Every Plan B points at an artifact that
already exists in this repo — a fallback path, a config switch, a script — not vibes.
Referenced from the demo slides (issue #19) and `docs/demo/storyboard.md`.

| Risk | Likelihood | Impact | Primary mitigation | Plan B (existing artifact) | Owner |
|---|---|---|---|---|---|
| Codex CLI integration breaks | Medium | Medium | Adapter protocol isolates each CLI behind `AgentAdapter` (`specs/020-adapter-protocol.md`); per-agent dirs under `src/adapters/` | Dispatch falls back to the built-in `local-dispatch` adapter (`src/server/local-dispatch.ts` — same artifact pipeline, no external CLI) or the `mock` adapter (`src/adapters/mock/`) for scripted runs | Evanlin |
| e2b sandbox over budget / unavailable | Medium | Low | `E2B_API_KEY` is optional; default runs never touch e2b | Workspaces are plain local dirs: `workspaceResolver` writes under `.roundtable/workspaces/` (`src/orchestrator`, `ROUNDTABLE_LOCAL_ROOT` in `.env`) — demo runs fully local | Gloria |
| Group chat doesn't ship in time | Low | Medium | Group-chat spec is staged (`specs/050-group-chat.md`); live path doesn't depend on it | Logged-out demo plays the scripted roundtable scene from fixtures (`src/ui/lib/rt.js`) — breakouts/DMs render from fixture data, zero backend needed | AntaresYuan |
| Claude Code `stream-json` format changes | Medium | Medium | Parsing isolated inside the claude-code adapter (`src/adapters/claude-code/`) | `skills/debug-stream-json` skill documents the repair procedure; until fixed, switch `ROUNDTABLE_AGENT_ADAPTER=local-dispatch` (env, no code change) | Evanlin |
| Volcano Engine model unavailable | **Happened (2026-06-09)** | High | Provider-agnostic LLM layer: every feature goes through `defaultOrchestratorModel()` (`src/orchestrator/llm/provider.ts` — volcano/deepseek/openai/anthropic/minimax) | **Exercised for real:** proxy couldn't reach `ark.cn-beijing.volces.com` → flipped `.env` to `ROUNDTABLE_LLM_PROVIDER=deepseek`, zero code change, verified by `pnpm orch:smoke:llm`. Even with *no* reachable LLM, turns degrade gracefully: heuristic intake + role planner + template artifacts, flagged `degraded` (`src/app/api/orchestrator/turn/route.ts`) | AntaresYuan |
| Orchestrator prompt regresses on eval | Medium | Medium | Smoke scripts gate changes: `pnpm orch:smoke` (deterministic) and `pnpm orch:smoke:llm` (live structured output) | Deterministic fallbacks ship in-tree: `heuristicIntake()` / `rolePlanner()` (`src/orchestrator/nodes/`) keep every turn producing a plan; prompt edits follow `skills/write-orchestrator-prompt` | Evanlin |
| Demo-day network blocks an LLM provider | Medium | High | Pre-flight check in the demo runbook: `curl` the active provider before recording (see `docs/demo/storyboard.md`) | Same switch as the Volcano row — any of 5 providers via one env var; worst case the demo still runs end-to-end in `degraded` mode (plan → approve → dispatch → artifacts all functional) | AntaresYuan |
| DB / Docker dies mid-demo | Low | High | `pnpm dev:services` + health-checked containers; turn store runs in `local` file mode (`ROUNDTABLE_TURN_STORE=local`) so live turns survive a DB outage | Turn history persists to `.roundtable/local-turns.json` (`src/server/local-turn-store.ts` falls back to file store on any DB error); restart Postgres with `docker restart roundtable-postgres` | Gloria |

## 答辩 one-liners

- **"What if Codex breaks?"** — Every coding agent sits behind the same `AgentAdapter` interface; we swap to the built-in local dispatcher with one env var and the run continues.
- **"What if the model is down?"** — It was down (our proxy blocked Volcano). We switched providers in config in under a minute, and even with zero LLM the orchestrator degrades to deterministic planning instead of failing — the turn is marked `degraded`, never broken.
- **"What if the sandbox costs too much?"** — We don't need it; workspaces are local directories by default.
