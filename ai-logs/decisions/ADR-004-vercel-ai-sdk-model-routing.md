# ADR-004: Use Vercel AI SDK for Orchestrator Model Routing

## Status

Accepted (2026-05-25)

## Context

Roundtable has two different AI execution paths:

- adapter sessions that run coding CLIs inside a workspace
- Orchestrator-side reasoning for intake, planning, and review routing

The Orchestrator path needs typed structured output, provider portability, and easy test doubles. It should not depend on any one CLI vendor because roles are product concepts and can be backed by different adapters.

## Decision

Use Vercel AI SDK as the Orchestrator LLM wrapper, with Anthropic as the default provider for the first implementation pass.

Expose model-backed orchestrator nodes through `src/lib/llm.ts` so the UI and server code have one stable import path for:

- `llmIntake`
- `llmPlanner`
- `defaultOrchestratorModel`
- `requireAnthropicKey`

## Why

- `generateObject` supports zod schemas directly, which keeps intake and planner outputs aligned with `src/contracts`.
- The provider abstraction keeps future OpenAI, Gemini, or hosted-router swaps out of the LangGraph node code.
- Tests can use `ai/test` mock models without live LLM calls.
- The adapter protocol remains separate from model routing, so CLI-backed coding agents can evolve independently.

## Consequences

- Production deployments must configure `ANTHROPIC_API_KEY` before enabling LLM-backed nodes.
- Heuristic intake/planning remain available as fallbacks for local development and tests.
- Any future provider-specific behavior should live behind `src/lib/llm.ts` or `src/orchestrator/llm/provider.ts`, not inside graph nodes.
