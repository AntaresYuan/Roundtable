# Spec 010: Orchestrator (PM)

## Goal

Define how the PM agent acts as Roundtable's terminal brain: it intakes plain-language user goals, clarifies only when needed, creates a role-based plan, dispatches work to CLI agents, monitors execution, routes review, and aggregates the result into user-facing next actions.

## Non-goals

- Not how individual Coding Agents work (see spec 020).
- Not the data shape of a hand-off (see spec 030).
- Not artifact rendering (see spec 040).

## Core value

> Stay silent unless speaking adds value. Stay short unless detail is required.

The Orchestrator is a *good PM*, not a verbose narrator.

For Roundtable's target user, the Orchestrator also translates raw engineering activity into understandable product progress. It should hide terminal noise, not hide important decisions.

## State machine

Seven stages run for every user message:

```
[1 Intake] -> [2 Clarify?] -> [3 Plan] -> [4 Dispatch] -> [5 Monitor] -> [6 Review] -> [7 Aggregate]
```

- **Intake** — light LLM call classifies the message on three axes: clarity (clear / ambiguous), complexity (trivial / multi-step), type (build / inspect / control). Output drives routing.
- **Clarify** — entered only when ambiguity score > 0.6. Max 3 questions. Always rendered as a structured card with selectable options (generative UI, not free text).
- **Plan** — emits a structured YAML plan: `{id, title, assignee, deps, parallel}`. Cuts by role, never by file.
- **Dispatch** — emits a *single* TodoList message that names every assignee and shows live status badges (⏳ / 🚀 / ✅ / ❌).
- **Monitor** — silent unless: an agent fails, an agent stalls > 60s, two agents conflict, or an agent-to-agent `@mention` loop exceeds depth 2.
- **Review** — sends the final diff or artifact set to a reviewer agent when the task changes executable code, data model, auth, deployment, or public UX. The reviewer proposes fixes; it does not directly commit.
- **Aggregate** — short summary + Quick Action buttons. Never restates what subordinate agents already shipped.

## Role model

Roles are product concepts, not hard-coded vendors. The same role can be backed by different adapters depending on availability, task type, and user preference.

The table below is a starter preset, not a fixed product rule. Users should be able to rename roles, adjust their responsibilities, and choose which adapter backs each role. The Orchestrator may suggest defaults, but the user remains in control.

| Role | Default purpose | Default adapter suggestions |
|---|---|---|
| `@architect` | system design, contracts, tradeoffs | Claude Code, Codex |
| `@planner` | task breakdown, acceptance criteria, sequencing | Custom Agent, Claude Code |
| `@implementer` | file edits and scaffold generation | Claude Code, OpenCode, Codex |
| `@reviewer` | critique, tests, maintainability, security review | Codex, Claude Code |
| `@fixer` | targeted bug, lint, build, and CI repair | Codex, OpenCode |

The Orchestrator dispatches to roles first, then selects the adapter registered for that role unless the user has chosen an explicit adapter override.

## Intake output

The Intake node must produce a structured object:

```ts
interface IntakeResult {
  intentType: 'build' | 'modify' | 'inspect' | 'debug' | 'review' | 'control';
  clarity: 'clear' | 'ambiguous';
  ambiguityScore: number;
  complexity: 'single_agent' | 'multi_agent';
  risk: 'low' | 'medium' | 'high';
  suggestedRoles: AgentRoleId[];
  userVisibleSummary: string;
}
```

Risk is high when the request touches auth, payments, secrets, production data, destructive file operations, deployment, or dependency upgrades.

## Plan shape

Plans are role-based. Avoid leaking low-level implementation details to non-technical users unless they ask.

```yaml
plan:
  - id: T1
    title: Confirm product requirements
    assignee: "@planner"
    deps: []
    user_visible: true
  - id: T2
    title: Implement waitlist page and CSV export
    assignee: "@implementer"
    deps: [T1]
    user_visible: true
  - id: T3
    title: Review diff and flag maintainability issues
    assignee: "@reviewer"
    deps: [T2]
    user_visible: true
```

Internal-only subtasks may exist, but the TodoList should use plain-language labels.

## Dispatch contract

Every dispatch creates:

1. one TodoList card in the visible chat
2. one `HandoffCard` per target role
3. one adapter session per role unless the role already has an active reusable session
4. one audit entry in `ai-logs/handoffs.jsonl`

Dispatch must include:

- isolated `cwd`
- allowed tools
- role prompt
- task brief
- relevant artifact refs
- interruption policy

## Monitoring rules

| Condition | Orchestrator action |
|---|---|
| Adapter emits recoverable `error` | Retry once with a shorter task brief and same workspace. |
| Adapter emits non-recoverable `error` | Mark task failed, summarize failure, offer switch-adapter Quick Action. |
| No event for 60s | Ask the agent for progress or interrupt if user requests. |
| `file_change` touches a downstream dependency | Trigger dependency graph badge and optional sync action. |
| Two agents edit same file | Run conflict flow: attempt merge, then show diff choices. |
| User clicks stop | Call `interrupt()` on active sessions and summarize partial artifacts. |

## User-facing aggregation

Aggregate messages should use this shape:

```text
Done: 3 tasks completed, 1 review note left.

Created:
- Waitlist page
- CSV export endpoint
- Review notes

[Preview] [Fix review note] [Add database] [Deploy]
```

Do not dump raw logs. Link to artifact cards, review cards, and diffs.

## Decision rules

- Clarify only when ambiguity score > 0.6.
- Plan only when ≥ 2 roles are needed; otherwise dispatch directly to a single agent.
- Conflict resolution order: auto 3-way merge → if fails, surface diff cards to user → if user is absent, defer to the dependency graph's authoritative side.
- Review is mandatory for code-writing tasks unless the user explicitly starts a throwaway scratchpad.

## Acceptance criteria

- [ ] PM does not clarify on unambiguous requests (≥ 90% of `intake.clear` cases skip clarify).
- [ ] PM emits a TodoList message on every multi-task dispatch (100%).
- [ ] PM aggregate message ≤ 4 lines + artifact list.
- [ ] PM never produces free-form clarification text — always structured cards.
- [ ] On agent failure, PM auto-retries once before surfacing to user.
- [ ] Code-writing tasks produce a review stage before final aggregate.
- [ ] User stop/interject calls `interrupt()` on every active session within 1s.

## Prompt

Lives in `prompts/orchestrator.md` (TBD). Versioned per release; old versions snapshotted to `ai-logs/prompt-history/`.

## Open questions

- Should Plan be visible to the user by default? Decided: **no** (collapsed behind "show plan").
- Should the user be able to override the Plan? Yes — see HandoffCard `[✎ Edit]` flow in spec 030.

## Changelog

- 2026-05-25 — added terminal-brain role model, review stage, dispatch contract, and monitoring rules.
- 2026-05-24 — initial draft.
