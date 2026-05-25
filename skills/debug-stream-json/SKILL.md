---
name: debug-stream-json
description: >-
  Debug the Claude Code CLI bridge when the stream-json protocol misbehaves.
  Triggers when the user says "claude code adapter is broken", "stream-json
  events are weird", "the claude subprocess hangs", "stdio deadlock", or shows
  symptoms like missing tool_use events, dropped text deltas, or zombie
  processes.
---

# Skill: Debug `stream-json` (Claude Code CLI bridge)

The Claude Code adapter is the most common source of bug reports because it bridges a subprocess to our event stream. Symptoms usually look like dropped events or stuck sessions.

## Quick triage (do this first, in order)

1. **Is the child alive?** `ps -p $PID` and check the `proc.exitCode`. If exited with non-zero, dump `stderr`.
2. **Is `stderr` being drained?** A full stderr pipe will block the child. Confirm `stderr.on('data', ...)` is wired.
3. **Are events line-delimited?** `stream-json` is NDJSON. Use `readline` on `stdout`, not a raw buffer concat.
4. **Auth state intact?** `~/.config/claude/` or the per-workspace config dir must exist and be readable.
5. **Headless flag passed?** Confirm `-p` (or whichever flag) is in `argv`. A missing flag makes the CLI go into TTY mode and stall.

## Common bugs & fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Subprocess hangs at start | TTY detection | Add `-p` / `--no-tty` / vendor headless flag. |
| Events freeze after ~64KB | stderr buffer full | Pipe stderr to a logger; never ignore it. |
| Missing `tool_use` events | NDJSON line not complete on chunk boundary | Use `readline` interface, not `data` handler. |
| Garbled UTF-8 | wrong encoding | `setEncoding('utf8')` on both stdout and stderr. |
| Session not resumable | `--resume <id>` passed wrong id | Inspect the session file location for the version of Claude Code installed; verify the id in the file matches. |
| Zombie processes | failed cleanup | Ensure `proc.kill('SIGTERM')` in `close()` AND a `proc.on('exit')` resolver in `interrupt()`. |

## Logging recipe

When debugging a specific failure, raise log verbosity temporarily:

```ts
logger.event('cc.stdout.line', { line });
logger.event('cc.stderr.line', { line });
logger.event('cc.exit', { code, signal });
```

Disable before merging.

## Repro fixtures

Recorded sessions live at `tests/adapters/claude-code/fixtures/`. Add a new fixture whenever a new bug is filed; the conformance test will replay it forever after.

## Acceptance

- [ ] Bug reproduces from a recorded fixture (don't fix what you can't replay).
- [ ] Fix is unit-tested against the fixture.
- [ ] If the bug exposed an invariant, that invariant is now asserted in `tests/adapters/_conformance.test.ts`.
- [ ] One-paragraph entry added to `ai-logs/incidents.md` describing the symptom, the cause, and the test that catches it.
