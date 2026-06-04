# AI Incidents

Append-only log of weird, wrong, or wasteful AI output. Each entry: what happened, why, what we changed so it can't happen the same way again.

## Format

```markdown
## YYYY-MM-DD — <one-line title>

**Symptom:** what we observed.
**Cause:** the underlying reason.
**Lesson:** what we changed (test added, rule added, prompt fixed).
**Reference:** prompt snapshot, commit, or PR link.
```

---

## 2026-06-04 — AI assumed Anthropic as the LLM provider

**Symptom:** While adding UI AI features (`ai.polish`, `ai.suggestTasks` in `src/server/routers/ai.ts`), the assistant told the user they "need `ANTHROPIC_API_KEY`" and reasoned about Anthropic as the provider.
**Cause:** `src/orchestrator/llm/provider.ts` on `main` still defaults to `anthropic('claude-sonnet-4-6')` (ADR-004's "Anthropic for the first implementation pass"), so the code looked Anthropic-based. The team's real PM-agent provider is **火山引擎 / Volcano Engine**, being wired on the unmerged `codex/deepseek-live-workflow` branch. The assistant read the stale default as the source of truth.
**Lesson:** Provider is centralized — any LLM-backed feature must reuse `defaultOrchestratorModel()` and never name a specific provider/key in code or messaging. Added as a convention in `AGENTS.md`. The feature code was already correct (it delegates to `defaultOrchestratorModel()`); only the messaging was wrong.
**Reference:** commit `d483c35`; memory `llm-provider-volcano.md`; ADR-004.

## 2026-05-24 — Initial scaffold

**Symptom:** N/A — this file is a placeholder until the first real incident.
**Cause:** No incidents yet; project is at scaffold stage.
**Lesson:** Keep this file populated as failures occur. Empty incident logs are a smell, not a virtue.
**Reference:** initial commit.
