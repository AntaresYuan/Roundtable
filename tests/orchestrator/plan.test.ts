import { describe, expect, it } from 'vitest';
import { rolePlanner, runPlan } from '../../src/orchestrator/nodes/plan.js';
import { initialState } from '../../src/orchestrator/state.js';

describe('rolePlanner', () => {
  it('produces role-assigned tasks with sequential deps', async () => {
    const base = initialState('c1', 'build something');
    const withIntake = {
      ...base,
      intake: {
        intentType: 'build' as const,
        clarity: 'clear' as const,
        ambiguityScore: 0.1,
        complexity: 'multi_agent' as const,
        risk: 'low' as const,
        suggestedRoles: ['planner', 'implementer', 'reviewer'] as Array<
          'planner' | 'implementer' | 'reviewer'
        >,
        userVisibleSummary: 'build something',
      },
    };
    const state = await runPlan({ ...withIntake, intake: withIntake.intake }, rolePlanner());
    expect(state.plan?.tasks).toHaveLength(3);
    expect(state.plan?.tasks[0]?.assignee).toBe('@planner');
    expect(state.plan?.tasks[1]?.deps).toEqual(['T1']);
    expect(state.stage).toBe('dispatch');
  });

  it('skips planning when intent is control', async () => {
    const base = initialState('c1', 'stop');
    const state = await runPlan(
      {
        ...base,
        intake: {
          intentType: 'control',
          clarity: 'clear',
          ambiguityScore: 0,
          complexity: 'single_agent',
          risk: 'low',
          suggestedRoles: [],
          userVisibleSummary: 'stop',
        },
      },
      rolePlanner(),
    );
    expect(state.plan).toBeUndefined();
    expect(state.stage).toBe('aggregate');
  });
});
