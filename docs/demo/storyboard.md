# Demo storyboard

Short scripted paths the demo runner can follow on stage. Each one is a single coherent story; pick one (or chain them) depending on time.

Risk table + Plan B for judge Q&A: [`docs/risk-register.md`](../risk-register.md).

## Pre-flight (run before recording / going on stage)

1. `docker ps` — postgres/redis up; else `pnpm dev:services`.
2. LLM reachable: `curl -m12 https://api.deepseek.com` returns an HTTP code (401 is fine). If blocked, switch `ROUNDTABLE_LLM_PROVIDER` in `.env` (see risk register) and restart the dev server.
3. `pnpm orch:smoke:llm` — must end `"errors": []` and a real intake (not heuristic).
4. `pnpm ui:dev` boots; send one throwaway message; confirm the plan card is **not** marked `degraded`.

## Live workflow run (primary scenario — fully working)

The end-to-end beat the product is built around: one user request → workflow-staged plan → approval gate → agents work per stage → reviewable artifacts.

**Stage path.**

1. **Ask.** Signed in, send a build request ("Add a dark-mode toggle to settings"). PM drafts a plan that follows the workbench workflow ("Ship a PR-ready feature": Plan → Build → Review → Ship) — point at the homepage WorkflowStrip lighting up the stages.
2. **Inspect the plan.** The Plan card is a live TodoList: per-task assignee avatars, dependency notes ("waits on T1"), status badges. Click "Show plan" for the structured view — "the plan is a real object, not prose."
3. **Approve.** Click Approve — "the human owns the gate; nothing dispatches without sign-off." Badges flip to running.
4. **Watch stages.** Each stage that starts gets its own card: Build (implementer working, spinner) then Review (reviewer). Task rows expand to show the agent's activity events.
5. **Read the work.** When done, expand the artifacts inside each stage card — real model-written implementation and review content. "Per-agent ownership is visible everywhere: color, avatar, role tag."
6. **Payoff line.** Re-send a follow-up message into the same task — the loop repeats inside one persistent chat with full history.

**Implementation references.** `src/app/api/orchestrator/turn/route.ts` (workflow-driven planning), `src/server/local-dispatch.ts` (staged dispatch + artifacts), `src/ui/components/app-root.jsx` (`LocalPlanCard` TodoList, `StageCards`).

## Cross-chat hand-off (scenario 4)

**Why this matters in the demo.** Spec 030 § Four scenarios calls out `cross_chat` as the demo-only scenario. It's the strongest "look, hand-offs really are first-class product objects" beat — the user moves an in-flight task between two chats and the recipient agent picks it up without re-explanation.

**Pre-conditions.**

- Two chats in the same workspace: **Chat A** (already in flight) and **Chat B** (empty / fresh).
- At least one dispatch has run in Chat A — the orchestrator has produced a `HandoffCard` and persisted it (via `dispatch.ts` → `generateHandoffCard` → `handoffs` table).
- At least one `web_app` or `code` artifact attached to that handoff (for the "snapshots travel" beat).

**Stage path.**

1. **Set the stakes (≈ 20s).** In Chat A, point at the latest HandoffCard inline in the conversation: "this is the structured context we'd lose in any other tool." Read the `userIntent` aloud.
2. **Export.** Click `Export context` in Chat A's header. UI calls `handoffs.export({ chatId: A })` → receives a `PortableHandoffCard` JSON → drops it on the clipboard or a download. Show the JSON briefly on screen to make "self-contained" tangible.
3. **Switch.** Open Chat B (fresh, no agents have spoken yet). Tooltip: "demo-only — production hand-offs stay in one chat."
4. **Import.** Click `Import context`, paste the JSON. UI calls `handoffs.import({ chatId: B, exported })`. The server validates the portable card, inserts a row in `handoffs` for Chat B (new id, `scenario: 'cross_chat'`, `fullHistoryRef: imported:<A>:...`), and posts a system message: **🔄 Context imported from chat `<A>` (intent: "...", 1 artifact(s) carried over). The next dispatch will pick up this hand-off.**
5. **Resume.** Type the *next* user message in Chat B ("ok, add password reset"). The orchestrator's next turn sees the imported handoff in the table, dispatches the named agent, and that agent's first reply references the inlined artifact without ever having seen Chat A.
6. **Tear-down beat.** Open Chat B's HandoffCard inline view — point at `previousAgent.summary` and the `relevantArtifacts` carried over from A. "No re-explanation. No copy-paste. The context moved."

**Things to *not* show in this beat.**

- Editing the HandoffCard mid-import (covered in a different scenario).
- Multi-agent fan-out in Chat B (we want one clean continuation, not noise).
- The dependency-changed badge (different demo).

**Implementation references.**

- `src/server/cross-chat.ts` — `buildPortableCard()` and `injectPortableCard()` are the backend primitives.
- `src/server/routers/handoffs.ts` — `export` query and `import` mutation are what the buttons call.
- `src/contracts/portable-handoff.ts` — the wire format (`format`, `version`, `sourceChatId`, `card`, `inlinedArtifacts`). Bump `PORTABLE_HANDOFF_VERSION` on any breaking shape change.
- `tests/server/cross-chat.test.ts` — exercises export → import round-trip end-to-end against pglite.

**Known gaps for v1 demo.**

- The "Export" / "Import" UI affordances are blocked on Next.js scaffolding (#11). Until then, demo this through tRPC client calls (or a thin CLI wrapper).
- Inlined artifacts carry `preview` + `uri`, not full file content. Re-fetching content in Chat B (so the imported agent can `read_artifact()`) is a follow-up if the demo proves the gap.
