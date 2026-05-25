# Adapter Template

Copy this directory to `src/adapters/<your-agent-id>/` and fill in the TODOs.

## What's in here

```
adapter-template/
├── README.md          # this file
├── index.ts           # exports the adapter
├── adapter.ts         # AgentAdapter implementation
├── session.ts         # AgentSession implementation
├── event-mapper.ts    # vendor event → AgentEvent (the only vendor-specific file)
└── capabilities.ts    # capabilities matrix
```

## How to use

1. Copy: `cp -r examples/adapter-template src/adapters/<your-id>`.
2. Rename `YourAgent` → `<YourId>Agent` everywhere.
3. Fill in the TODOs in each file (search the directory for `TODO(template)`).
4. Register your adapter in `src/adapters/registry.ts`.
5. Follow `skills/add-agent-adapter/SKILL.md` for the remaining steps (specs, tests, capabilities table).

## Conventions

- Keep vendor-specific imports out of `adapter.ts` and `session.ts`. They belong only in `event-mapper.ts`.
- Every emitted event must satisfy the `AgentEvent` discriminated union. Run `pnpm typecheck` after every TODO.
- Workspace isolation: `SessionOpts.cwd` is the only directory you may write to.
