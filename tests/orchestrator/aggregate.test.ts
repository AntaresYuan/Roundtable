import { describe, expect, it } from 'vitest';
import type { Artifact, ArtifactId } from '../../src/contracts/index.js';
import { runAggregate } from '../../src/orchestrator/nodes/aggregate.js';
import { initialState, type OrchestratorState } from '../../src/orchestrator/state.js';

function artifact(
  id: string,
  version: number,
  ownerAgentId: string,
  title: string,
): Artifact {
  return {
    id: id as ArtifactId,
    kind: 'file',
    title,
    ownerAgentId,
    version,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };
}

function stateWithArtifacts(artifacts: Artifact[]): OrchestratorState {
  return {
    ...initialState('chat/1', 'build a page'),
    stage: 'aggregate',
    artifacts,
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

describe('runAggregate', () => {
  it('builds bullets from state.artifacts (canonical list)', async () => {
    const a1 = artifact('art-1', 1, 'implementer', 'LandingPage.tsx');
    const a2 = artifact('art-2', 1, 'implementer', 'api/waitlist.ts');

    const result = await runAggregate(stateWithArtifacts([a1, a2]));

    expect(result.aggregate?.bullets).toEqual([
      'LandingPage.tsx',
      'api/waitlist.ts',
    ]);
    expect(result.stage).toBe('done');
  });

  it('does not duplicate bullets when an artifact also appears in dispatch events', async () => {
    const a = artifact('art-1', 1, 'implementer', 'LandingPage.tsx');
    const base = stateWithArtifacts([a]);
    const state: OrchestratorState = {
      ...base,
      dispatch: [
        {
          ...base.dispatch[0]!,
          events: [{ type: 'artifact', artifact: a }],
        },
      ],
    };

    const result = await runAggregate(state);

    expect(result.aggregate?.bullets).toEqual(['LandingPage.tsx']);
  });
});
