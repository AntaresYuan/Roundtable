import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, describe, expect, it } from 'vitest';
import { llmIntake as publicLlmIntake, llmPlanner as publicLlmPlanner } from '../../src/lib/llm.js';
import {
  llmIntake,
  llmPlanner,
  orchestratorModelConfig,
  requireOrchestratorKey,
} from '../../src/orchestrator/llm/index.js';
import type { IntakeClassifier } from '../../src/orchestrator/nodes/intake.js';
import { initialState } from '../../src/orchestrator/state.js';

function mockObjectModel(jsonObject: unknown) {
  const doGenerate = (async () => ({
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    content: [{ type: 'text', text: JSON.stringify(jsonObject) }],
    warnings: [],
  })) as never;
  return new MockLanguageModelV3({ doGenerate });
}

function mockObjectFailureThenTextModel(jsonObject: unknown) {
  let calls = 0;
  const doGenerate = (async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('response_format unsupported');
    }
    return {
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(jsonObject)}\n\`\`\`` }],
      warnings: [],
    };
  }) as never;
  return new MockLanguageModelV3({ doGenerate });
}

const ENV_KEYS = [
  'ROUNDTABLE_LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_MODEL',
  'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL',
  'MINIMAX_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('llmIntake', () => {
  it('exports the public LLM wrapper entry points', () => {
    expect(publicLlmIntake).toBe(llmIntake);
    expect(publicLlmPlanner).toBe(llmPlanner);
  });

  it('returns the model-supplied IntakeResult', async () => {
    const intake = llmIntake({
      model: mockObjectModel({
        intentType: 'build',
        clarity: 'clear',
        ambiguityScore: 0.1,
        complexity: 'multi_agent',
        risk: 'low',
        suggestedRoles: ['planner', 'implementer', 'reviewer'],
        userVisibleSummary: 'Build waitlist',
      }),
    });
    const result = await intake.classify('Build a waitlist page');
    expect(result.intentType).toBe('build');
    expect(result.suggestedRoles).toEqual(['planner', 'implementer', 'reviewer']);
  });

  it('falls back to the heuristic when the model throws', async () => {
    const errorModel = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error('rate-limited');
      },
    });
    const fallback: IntakeClassifier = {
      async classify() {
        return {
          intentType: 'modify',
          clarity: 'clear',
          ambiguityScore: 0,
          complexity: 'single_agent',
          risk: 'low',
          suggestedRoles: ['implementer'],
          userVisibleSummary: 'fallback',
        };
      },
    };
    const intake = llmIntake({ model: errorModel, fallback });
    const result = await intake.classify('do the thing');
    expect(result.userVisibleSummary).toBe('fallback');
  });

  it('parses JSON text when structured output is unavailable', async () => {
    const intake = llmIntake({
      model: mockObjectFailureThenTextModel({
        intentType: 'debug',
        clarity: 'clear',
        ambiguityScore: 0.2,
        complexity: 'multi_agent',
        risk: 'medium',
        suggestedRoles: ['fixer', 'reviewer'],
        userVisibleSummary: 'Debug the workflow',
      }),
      fallback: {
        async classify() {
          throw new Error('heuristic fallback should not run');
        },
      },
    });

    const result = await intake.classify('debug the workflow');
    expect(result.intentType).toBe('debug');
    expect(result.suggestedRoles).toEqual(['fixer', 'reviewer']);
  });
});

describe('llmPlanner', () => {
  it('assembles a plan with sequential ids', async () => {
    const planner = llmPlanner({
      model: mockObjectModel({
        tasks: [
          { title: 'Plan waitlist', assignee: '@planner', deps: [], user_visible: true },
          { title: 'Implement page', assignee: '@implementer', deps: ['T1'], user_visible: true },
          { title: 'Review diff', assignee: '@reviewer', deps: ['T2'], user_visible: true },
        ],
      }),
    });
    const state = {
      ...initialState('c1', 'Build a waitlist'),
      intake: {
        intentType: 'build' as const,
        clarity: 'clear' as const,
        ambiguityScore: 0.1,
        complexity: 'multi_agent' as const,
        risk: 'low' as const,
        suggestedRoles: ['planner', 'implementer', 'reviewer'] as Array<
          'planner' | 'implementer' | 'reviewer'
        >,
        userVisibleSummary: 'Build a waitlist',
      },
    };
    const plan = await planner.buildPlan(state);
    expect(plan.tasks.map((t) => t.id)).toEqual(['T1', 'T2', 'T3']);
    expect(plan.tasks[1]?.deps).toEqual(['T1']);
    expect(plan.tasks[0]?.assignee).toBe('@planner');
  });

  it('drops forward-referencing deps from the model', async () => {
    const planner = llmPlanner({
      model: mockObjectModel({
        tasks: [
          { title: 'a', assignee: '@implementer', deps: ['T2', 'T9'], user_visible: true },
          { title: 'b', assignee: '@reviewer', deps: ['T1'], user_visible: true },
        ],
      }),
    });
    const state = initialState('c1', 'do something');
    const plan = await planner.buildPlan(state);
    expect(plan.tasks[0]?.deps).toEqual([]);
    expect(plan.tasks[1]?.deps).toEqual(['T1']);
  });

  it('parses JSON text plans when structured output is unavailable', async () => {
    const planner = llmPlanner({
      model: mockObjectFailureThenTextModel({
        tasks: [
          { title: 'Patch provider', assignee: '@implementer', deps: [], user_visible: true },
          { title: 'Review provider', assignee: '@reviewer', deps: ['T1'], user_visible: true },
        ],
      }),
      fallback: {
        async buildPlan() {
          throw new Error('role fallback should not run');
        },
      },
    });

    const state = initialState('c1', 'fix provider');
    const plan = await planner.buildPlan(state);
    expect(plan.tasks.map((task) => task.title)).toEqual([
      'Patch provider',
      'Review provider',
    ]);
    expect(plan.tasks[1]?.deps).toEqual(['T1']);
  });

  it('normalizes numeric JSON text deps from compatible providers', async () => {
    const planner = llmPlanner({
      model: mockObjectFailureThenTextModel({
        tasks: [
          { title: 'Build page', assignee: '@implementer', deps: [], user_visible: true },
          { title: 'Review page', assignee: '@reviewer', deps: [1], user_visible: true },
        ],
      }),
      fallback: {
        async buildPlan() {
          throw new Error('role fallback should not run');
        },
      },
    });

    const plan = await planner.buildPlan(initialState('c1', 'build page'));
    expect(plan.tasks[1]?.deps).toEqual(['T1']);
  });

  it('normalizes numeric structured deps from compatible providers', async () => {
    const planner = llmPlanner({
      model: mockObjectModel({
        tasks: [
          { title: 'Build page', assignee: '@implementer', deps: [], user_visible: true },
          { title: 'Review page', assignee: '@reviewer', deps: [1], user_visible: true },
        ],
      }),
      fallback: {
        async buildPlan() {
          throw new Error('role fallback should not run');
        },
      },
    });

    const plan = await planner.buildPlan(initialState('c1', 'build page'));
    expect(plan.tasks[1]?.deps).toEqual(['T1']);
  });

  it('normalizes zero-based numeric JSON text deps', async () => {
    const planner = llmPlanner({
      model: mockObjectFailureThenTextModel({
        tasks: [
          { title: 'Design page', assignee: '@planner', deps: [], user_visible: true },
          { title: 'Build page', assignee: '@implementer', deps: [0], user_visible: true },
        ],
      }),
      fallback: {
        async buildPlan() {
          throw new Error('role fallback should not run');
        },
      },
    });

    const plan = await planner.buildPlan(initialState('c1', 'build page'));
    expect(plan.tasks[1]?.deps).toEqual(['T1']);
  });
});

describe('orchestratorModelConfig', () => {
  it('supports DeepSeek as a local live provider', () => {
    process.env['ROUNDTABLE_LLM_PROVIDER'] = 'deepseek';
    process.env['DEEPSEEK_MODEL'] = 'deepseek-v4-flash';
    process.env['DEEPSEEK_BASE_URL'] = 'https://example.deepseek.test';
    process.env['DEEPSEEK_API_KEY'] = 'test-key';

    expect(orchestratorModelConfig()).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      baseURL: 'https://example.deepseek.test',
    });
    expect(() => requireOrchestratorKey()).not.toThrow();
  });

  it('fails clearly when DeepSeek is selected without a key', () => {
    process.env['ROUNDTABLE_LLM_PROVIDER'] = 'deepseek';
    delete process.env['DEEPSEEK_API_KEY'];

    expect(() => requireOrchestratorKey()).toThrow(
      'DEEPSEEK_API_KEY is not set. Configure it before using DeepSeek-backed orchestrator nodes.',
    );
  });

  it('supports OpenAI as a local live provider', () => {
    process.env['ROUNDTABLE_LLM_PROVIDER'] = 'openai';
    process.env['OPENAI_MODEL'] = 'gpt-4o-mini';
    process.env['OPENAI_BASE_URL'] = 'https://example.test/v1';
    process.env['OPENAI_API_KEY'] = 'test-key';

    expect(orchestratorModelConfig()).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseURL: 'https://example.test/v1',
    });
    expect(() => requireOrchestratorKey()).not.toThrow();
  });

  it('fails clearly when OpenAI is selected without a key', () => {
    process.env['ROUNDTABLE_LLM_PROVIDER'] = 'openai';
    delete process.env['OPENAI_API_KEY'];

    expect(() => requireOrchestratorKey()).toThrow(
      'OPENAI_API_KEY is not set. Configure it before using OpenAI-backed orchestrator nodes.',
    );
  });
});
