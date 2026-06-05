import { describe, expect, it } from 'vitest';
import {
  collectSkillProposals,
  MAX_SKILL_PROPOSALS_PER_RUN,
  noopSkillProposer,
  type SkillProposer,
} from '../../src/orchestrator/nodes/skill-proposer.js';
import { runAggregate } from '../../src/orchestrator/nodes/aggregate.js';
import { initialState, type OrchestratorState } from '../../src/orchestrator/state.js';

function stateAtAggregate(): OrchestratorState {
  return {
    ...initialState('chat/1', 'build a waitlist signup form'),
    stage: 'aggregate',
    dispatch: [
      {
        taskId: 'T1',
        handoffCardId: 'hc-1',
        sessionId: 'sess-1',
        status: 'completed',
        events: [],
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    ],
  };
}

describe('skill proposer', () => {
  it('noop proposer returns no proposals (default; preserves pre-#119 behavior)', async () => {
    const result = await runAggregate(stateAtAggregate(), noopSkillProposer());
    expect(result.proposedSkills).toEqual([]);
    expect(result.stage).toBe('done');
  });

  it('aggregate without a proposer wired returns no proposals', async () => {
    const result = await runAggregate(stateAtAggregate());
    expect(result.proposedSkills).toEqual([]);
  });

  it('proposer events flow into state.proposedSkills', async () => {
    const proposer: SkillProposer = {
      async propose() {
        return [
          {
            type: 'propose_skill' as const,
            name: 'server-action form submit',
            triggerHint: 'form, submit, waitlist',
            body: 'Prefer Next.js server actions over client fetch.',
          },
        ];
      },
    };
    const result = await runAggregate(stateAtAggregate(), proposer);
    expect(result.proposedSkills).toHaveLength(1);
    expect(result.proposedSkills[0]).toMatchObject({
      type: 'propose_skill',
      name: 'server-action form submit',
      triggerHint: 'form, submit, waitlist',
    });
  });

  it('caps proposals at MAX_SKILL_PROPOSALS_PER_RUN (UI noise budget)', async () => {
    const spammy: SkillProposer = {
      async propose() {
        return Array.from({ length: 5 }, (_, i) => ({
          type: 'propose_skill' as const,
          name: `skill ${i}`,
          triggerHint: `kw${i}`,
          body: 'body',
        }));
      },
    };
    const proposals = await collectSkillProposals(stateAtAggregate(), spammy);
    expect(proposals).toHaveLength(MAX_SKILL_PROPOSALS_PER_RUN);
  });

  it('a thrown proposer error is swallowed — aggregate still completes (resilience)', async () => {
    const broken: SkillProposer = {
      async propose() {
        throw new Error('LLM is on fire');
      },
    };
    const result = await runAggregate(stateAtAggregate(), broken);
    expect(result.proposedSkills).toEqual([]);
    expect(result.stage).toBe('done');
  });

  it('filters out non-propose_skill events even if a proposer returns them', async () => {
    const weird: SkillProposer = {
      async propose() {
        // Cast through unknown — exercises the runtime guard against a
        // misbehaving proposer that violates its type contract.
        return [
          { type: 'text_delta', delta: 'sneaky' },
          {
            type: 'propose_skill' as const,
            name: 'real one',
            triggerHint: 'kw',
            body: 'b',
          },
        ] as unknown as Awaited<ReturnType<SkillProposer['propose']>>;
      },
    };
    const proposals = await collectSkillProposals(stateAtAggregate(), weird);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.type).toBe('propose_skill');
  });
});
