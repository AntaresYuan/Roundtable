---
name: write-orchestrator-prompt
description: >-
  Modify the Orchestrator (PM) prompt safely. Triggers when the user says
  "tune the orchestrator", "change PM behavior", "the PM is too chatty", "fix
  the orchestrator clarification step", or anything that affects how the PM
  routes, plans, dispatches, or summarizes.
---

# Skill: Write / Tune the Orchestrator Prompt

The Orchestrator prompt is load-bearing. A regression here breaks every conversation. Follow this checklist; never ship a prompt change without an eval pass.

## Where the prompt lives

`prompts/orchestrator.md` (TBD path; create on first use). Versioned via filename suffix: `orchestrator.v3.md`. Old versions snapshot to `ai-logs/prompt-history/orchestrator-vN.md` on every change.

## Invariants (these cannot be removed)

1. PM's first stated value: "be silent unless speaking adds value."
2. Clarify only when ambiguity > 0.6; max 3 questions; always structured options.
3. Plan only when ≥ 2 roles are needed.
4. Dispatch is exactly **one** TodoList message.
5. Aggregate ≤ 4 lines + artifact list. Never restate what sub-agents shipped.

Violating any invariant is a regression.

## Procedure

1. Read the current prompt and the spec at `specs/010-orchestrator.md`.
2. State the desired behavior change in one sentence in your PR description.
3. Snapshot the current prompt: `cp prompts/orchestrator.md ai-logs/prompt-history/orchestrator-$(date +%Y%m%d-%H%M).md`.
4. Edit the prompt. Keep diffs surgical.
5. Run the eval suite: `pnpm eval orchestrator`. Required pass rate: ≥ 90% on the 30+ labeled cases under `evals/orchestrator/`.
6. Write a one-paragraph entry in `ai-logs/decisions/` if the change is load-bearing (e.g., changed an invariant, removed a stage).

## Eval cases (categories the suite must cover)

- `intake.clear.simple` — single role, no clarify, dispatch direct.
- `intake.clear.multi` — multi-role, no clarify, plan + dispatch.
- `intake.ambiguous` — ambiguity > 0.6, must clarify with structured options.
- `monitor.failure` — sub-agent errors; PM retries once then escalates.
- `monitor.conflict` — same-file conflict; PM produces diff cards.
- `aggregate.brevity` — final summary ≤ 4 lines, no restatement.

## Anti-patterns

- Asking "should I use React or Vue?" or any implementation-detail question.
- Dumping the YAML plan into the chat verbatim.
- Restating each sub-agent's output in the aggregate.
- Open-ended clarification questions (must always have options).

## Acceptance

- [ ] Snapshot exists in `ai-logs/prompt-history/`.
- [ ] Eval pass rate ≥ 90%.
- [ ] If an invariant changed, ADR added.
- [ ] PR description states the behavior change in one sentence.
