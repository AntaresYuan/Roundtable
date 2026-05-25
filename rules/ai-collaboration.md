# AI Collaboration Rules

Our team uses Claude Code and Cursor heavily. These rules keep us aligned and the project legible.

## When to ask AI vs ask the team

| Ask AI | Ask the team |
|---|---|
| Implementation details, refactors, test writing, doc drafts | Architectural decisions (load-bearing) |
| Library / API lookup | Product cuts, scope changes |
| Generating fixtures, mock data | Time budget vs scope trade-offs |
| Debugging known-class bugs | Sensitive customer-facing decisions |

When uncertain, ask both — but the team makes the final call on the right column.

## What to record

- **Every architectural decision** → `ai-logs/decisions/ADR-NNN-<topic>.md`.
- **Every weird AI output that wasted your time** → `ai-logs/incidents.md` with prompt, output, and lesson.
- **Every reusable AI prompt** that produced a good result → `ai-logs/prompt-history/<topic>.md`.

If you discover something an agent should know, write it in `AGENTS.md` or the relevant spec — don't only put it in chat.

## Prompt hygiene

- No secrets, API keys, or customer PII in prompts.
- Use repo-relative paths so context is reproducible.
- Important prompts go to version control (`prompts/` or `ai-logs/prompt-history/`), not just in a chat session.

## Pairing protocol

- Driver writes code; navigator drives the AI conversation.
- Switch roles every 25 minutes.
- AI is the "third pair" — always cross-check. Never merge AI-generated code you don't understand.

## Pre-commit

- `pnpm lint && pnpm test` pass locally (the pre-commit hook also enforces).
- If you changed an interface, the relevant spec is updated in the same commit.
- If you changed the repo structure, `AGENTS.md` is updated in the same commit.

## When AI is wrong

1. Capture the prompt + the wrong output in `ai-logs/incidents.md` with the date.
2. Add a guard (a test, a lint rule, a type) that would have caught it.
3. Don't silently fix AI's mistake. Leave a comment in the diff: `// AI proposed X; we changed to Y because Z.`
4. If the same class of mistake repeats ≥ 3 times, add a rule to `AGENTS.md` or the relevant `specs/` doc.

## Attribution

- No `Co-Authored-By: Claude` (or any AI) trailer in commits or PRs. Commits go under the human author only.
- This is a global team rule; do not add AI-attribution lines even if a tool suggests them.

## Skill authoring

When you find yourself doing the same procedure twice for the same kind of task, write it as a `skills/<name>/SKILL.md`. The skill should:

- Have an explicit trigger list in the frontmatter `description`.
- State acceptance criteria.
- Live alongside any templates or fixtures it references.
