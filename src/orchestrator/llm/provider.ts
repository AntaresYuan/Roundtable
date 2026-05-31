import type { LanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

/**
 * Roundtable's default model for orchestrator-side reasoning (intake, planner,
 * reviewer). Coding agents are spawned as separate adapter sessions and pick
 * their own models — this is only for the PM brain.
 *
 * Why Anthropic specifically: the orchestrator uses zod-typed structured
 * output (`generateObject`), and Anthropic's tool-call mode produces the most
 * reliable schema-conformant JSON in our testing as of 2026-05.
 *
 * Why Vercel AI SDK as the wrapper: provider-agnostic `generateObject` with
 * native zod support, so swapping to OpenAI/Gemini is a one-line change.
 */
export function defaultOrchestratorModel(): LanguageModel {
  return anthropic('claude-sonnet-4-6');
}

export function requireAnthropicKey(): void {
  if (!process.env['ANTHROPIC_API_KEY']) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Configure it before using LLM-backed orchestrator nodes.',
    );
  }
}
