import type { LanguageModel } from 'ai';
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

type OrchestratorProvider = 'anthropic' | 'deepseek' | 'minimax' | 'openai';

export interface OrchestratorModelConfig {
  provider: OrchestratorProvider;
  model: string;
  baseURL?: string;
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.io/anthropic/v1';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/**
 * Roundtable's default model for orchestrator-side reasoning (intake, planner,
 * reviewer). Coding agents are spawned as separate adapter sessions and pick
 * their own models — this is only for the PM brain.
 *
 * Anthropic is the production default because the orchestrator uses zod-typed
 * structured output (`generateObject`). For local comparison runs, set
 * `ROUNDTABLE_LLM_PROVIDER=deepseek` or `minimax` to route through compatible
 * provider endpoints, or `ROUNDTABLE_LLM_PROVIDER=openai` to use a standard
 * OpenAI key.
 *
 * Why Vercel AI SDK as the wrapper: provider-agnostic `generateObject` with
 * native zod support, so swapping to OpenAI/Gemini is a one-line change.
 */
export function defaultOrchestratorModel(): LanguageModel {
  const config = orchestratorModelConfig();
  if (config.provider === 'deepseek') {
    const deepseek = createOpenAI({
      apiKey: process.env['DEEPSEEK_API_KEY'] ?? '',
      baseURL: config.baseURL ?? DEFAULT_DEEPSEEK_BASE_URL,
      name: 'deepseek',
    });
    return deepseek.chat(config.model);
  }

  if (config.provider === 'minimax') {
    const apiKey = process.env['MINIMAX_API_KEY'] ?? '';
    const minimax = createAnthropic({
      apiKey,
      baseURL: config.baseURL ?? DEFAULT_MINIMAX_BASE_URL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
      },
      name: 'minimax',
    });
    return minimax(config.model);
  }
  if (config.provider === 'openai') {
    const openai = createOpenAI({
      apiKey: process.env['OPENAI_API_KEY'] ?? '',
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return openai(config.model);
  }

  return anthropic(config.model);
}

export function orchestratorModelConfig(): OrchestratorModelConfig {
  const provider = normalizeProvider(process.env['ROUNDTABLE_LLM_PROVIDER']);
  if (provider === 'deepseek') {
    return {
      provider,
      model: process.env['DEEPSEEK_MODEL'] || DEFAULT_DEEPSEEK_MODEL,
      baseURL: process.env['DEEPSEEK_BASE_URL'] || DEFAULT_DEEPSEEK_BASE_URL,
    };
  }

  if (provider === 'minimax') {
    return {
      provider,
      model: process.env['MINIMAX_MODEL'] || DEFAULT_MINIMAX_MODEL,
      baseURL: process.env['MINIMAX_BASE_URL'] || DEFAULT_MINIMAX_BASE_URL,
    };
  }
  if (provider === 'openai') {
    return {
      provider,
      model: process.env['OPENAI_MODEL'] || DEFAULT_OPENAI_MODEL,
      ...(process.env['OPENAI_BASE_URL'] ? { baseURL: process.env['OPENAI_BASE_URL'] } : {}),
    };
  }

  return {
    provider,
    model: process.env['ANTHROPIC_MODEL'] || DEFAULT_ANTHROPIC_MODEL,
  };
}

export function requireAnthropicKey(): void {
  requireOrchestratorKey();
}

export function requireOrchestratorKey(): void {
  const config = orchestratorModelConfig();
  if (config.provider === 'deepseek') {
    if (!process.env['DEEPSEEK_API_KEY']) {
      throw new Error(
        'DEEPSEEK_API_KEY is not set. Configure it before using DeepSeek-backed orchestrator nodes.',
      );
    }
    return;
  }

  if (config.provider === 'minimax') {
    if (!process.env['MINIMAX_API_KEY']) {
      throw new Error(
        'MINIMAX_API_KEY is not set. Configure it before using MiniMax-backed orchestrator nodes.',
      );
    }
    return;
  }

  if (config.provider === 'openai') {
    if (!process.env['OPENAI_API_KEY']) {
      throw new Error(
        'OPENAI_API_KEY is not set. Configure it before using OpenAI-backed orchestrator nodes.',
      );
    }
    return;
  }

  if (!process.env['ANTHROPIC_API_KEY']) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Configure it before using LLM-backed orchestrator nodes.',
    );
  }
}

function normalizeProvider(value: string | undefined): OrchestratorProvider {
  if (!value) return 'anthropic';
  const normalized = value.toLowerCase();
  if (normalized === 'deepseek') return 'deepseek';
  if (normalized === 'minimax') return 'minimax';
  if (normalized === 'anthropic') return 'anthropic';
  if (normalized === 'openai') return 'openai';
  throw new Error(`Unsupported ROUNDTABLE_LLM_PROVIDER: ${value}`);
}
