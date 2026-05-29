import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { llmIntake as publicLlmIntake, llmPlanner as publicLlmPlanner } from '../../src/lib/llm.js';
import { llmIntake, llmPlanner } from '../../src/orchestrator/llm/index.js';
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
});
