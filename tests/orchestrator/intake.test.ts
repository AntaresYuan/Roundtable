import { describe, expect, it } from 'vitest';
import { heuristicIntake, runIntake } from '../../src/orchestrator/nodes/intake.js';
import { initialState } from '../../src/orchestrator/state.js';

describe('heuristicIntake', () => {
  it('classifies clear build request', async () => {
    const intake = heuristicIntake();
    const state = await runIntake(
      initialState('c1', 'Build a waitlist page with CSV export'),
      intake,
    );
    expect(state.intake?.intentType).toBe('build');
    expect(state.intake?.clarity).toBe('clear');
    expect(state.stage).toBe('plan');
  });

  it('flags ambiguous short message', async () => {
    const intake = heuristicIntake();
    const state = await runIntake(initialState('c1', 'idk'), intake);
    expect(state.intake?.clarity).toBe('ambiguous');
    expect(state.stage).toBe('clarify');
  });

  it('marks risk high on deploy keyword', async () => {
    const intake = heuristicIntake();
    const state = await runIntake(
      initialState('c1', 'Deploy this to production'),
      intake,
    );
    expect(state.intake?.risk).toBe('high');
  });
});
