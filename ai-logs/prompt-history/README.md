# prompt-history/

Snapshots of important prompts at the moment they changed.

## When to add a snapshot

- Before editing the Orchestrator prompt (`prompts/orchestrator.md`).
- Before changing any system prompt that affects production behavior.
- Whenever a prompt was load-bearing in an ADR.

## Naming

`<topic>-<YYYYMMDD>[-<short-label>].md`

Examples:

- `orchestrator-20260522-initial.md`
- `2026-05-22-framework-comparison.md` (research output)
- `2026-05-24-agent-spawn-debate.md` (decision-grade prompt + response)

## Immutability

Once committed, snapshots are read-only. Supersede with a new snapshot rather than editing.
