# Commit message format

We use Conventional Commits with light enforcement.

## Format

```
<type>(<scope>): <imperative summary, ≤ 70 chars>

<body — optional, wrap at 72 chars>

<footer — optional, references like "Closes #123">
```

## Types

| Type | When |
|---|---|
| `feat` | New user-visible capability. |
| `fix` | Bug fix. |
| `refactor` | Code change with no behavior change. |
| `docs` | Spec, README, comment, ADR. |
| `test` | Tests only. |
| `chore` | Tooling, deps, CI. |
| `perf` | Performance work with a measurable target. |

## Scope

Optional. Use repo top-level dirs or feature areas: `adapters`, `orchestrator`, `contracts`, `ui`, `server`, `specs`, `skills`.

## Rules

- Imperative mood: "add", "fix", "remove" — not "added" / "adds".
- ≤ 70 chars in the subject line.
- One logical change per commit. No combo commits.
- No AI-attribution trailers (`Co-Authored-By: Claude`, etc.).
- If the commit references an ADR or spec, link it in the body.

## Examples

```
feat(adapters): add OpenCode HTTP adapter

Wraps `opencode serve` on a per-workspace base URL. SSE stream maps
straight to AgentEvent — see specs/020-adapter-protocol.md.

Closes #42
```

```
fix(orchestrator): suppress aggregate when no artifacts shipped
```

```
docs(specs): clarify dependency-graph depth-2 cap
```
