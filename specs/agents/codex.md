# Agent: Codex (OpenAI Codex CLI)

Second first-class Coding Agent adapter alongside Claude Code, satisfying the
"≥2 agent platforms" requirement (spec 020). Source: `src/adapters/codex/`.

## What it is

OpenAI's `codex` command-line coding agent, run **non-interactively** via
`codex exec --json`. The adapter spawns one process per turn and maps codex's
JSONL event stream to Roundtable `AgentEvent`s.

## Transport & invocation

- **Transport:** CLI subprocess, single-turn (`codex exec`), not a persistent server.
- **Command:** `codex exec --json --skip-git-repo-check -s <sandbox> -c approval_policy=never [-m <model>] -`
- **Prompt:** fed over **stdin** (prompt arg is `-`) so arbitrary prompt text
  never has to survive argv/shell quoting. The role `systemPrompt` is folded
  into the prompt (codex has no `--append-system-prompt`).
- **Shell spawn:** spawned with `shell: true` so Windows resolves the `codex.cmd`
  npm shim (bare `spawn('codex')` throws on `.cmd` post-CVE-2024-27980). Args are
  fixed flags only — the prompt is on stdin — so there is no shell-injection surface.

## Streaming protocol (codex-cli 0.139)

JSONL on stdout, one event per line. Mapped in `normalize.ts`:

| codex event | → AgentEvent |
|---|---|
| `thread.started` `{thread_id}` | captured (diagnostics), no event |
| `turn.started` | — |
| `item.completed` `agent_message` | `text_delta` |
| `item.completed` `reasoning` | `thinking_delta` |
| `item.completed` `command_execution` | `tool_use` + `tool_result` |
| `item.completed` `file_change` / `patch` | one `file_change` per changed path |
| `item.completed` (other) | generic `tool_use` |
| `turn.completed` `{usage}` | `done` (usage normalized) |
| `turn.failed` `{error}` | `error` (recoverable: false) |
| `error` (transient "Reconnecting…") | ignored — terminal failure arrives as `turn.failed` |

## Capabilities

`streaming` ✓ · `toolUse` ✓ · `fileEdits` ✓ · `mcp` ✓ · `multimodal` ✗ ·
`persistentSessions` ✗ (codex `exec resume` is not plumbed yet).

## Auth & env

- **Auth:** the codex CLI's own login (`codex login --with-api-key`, or ChatGPT
  OAuth). The adapter does not handle credentials — it inherits the machine's
  `~/.codex/auth.json`. Calls hit `api.openai.com`.
- `ROUNDTABLE_CODEX_COMMAND` — override the executable (default `codex`).
- `ROUNDTABLE_CODEX_MODEL` — `-m <model>` override (default: codex's configured model).
- `ROUNDTABLE_CODEX_SANDBOX` — codex sandbox policy (default `workspace-write`,
  which the implementer needs to land files; reviewers can use `read-only`).
- `ROUNDTABLE_ADAPTER_<ROLE>=codex` — bind a specific role to codex (e.g.
  `ROUNDTABLE_ADAPTER_REVIEWER=codex`). Roles also reach codex via `@codex` routing.

## Quirks / gotchas

- **stdin EOF:** codex `exec` blocks ("Reading additional input from stdin…")
  until stdin closes. The adapter writes the prompt then immediately ends stdin.
- **API key BOM:** piping a key into `codex login --with-api-key` from PowerShell
  prepends a UTF-8 BOM, producing `401 Incorrect API key`. Log in from a BOM-free
  source (cmd `< keyfile`, or `.NET WriteAllText` without BOM).
- **DEP0190:** `shell: true` + args emits a Node deprecation warning; benign here
  because args carry no user input (prompt is on stdin).
- **Sandbox vs approvals:** `-s workspace-write` alone still refuses writes when
  approvals are required; the adapter pairs it with `-c approval_policy=never`.

## Tests

`tests/adapters/codex/normalize.test.ts` (event mapping) and
`tests/adapters/codex/adapter.test.ts` (session via injected fake spawner). Both
run without a live model.
