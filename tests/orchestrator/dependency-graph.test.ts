import { describe, expect, it } from 'vitest';
import type {
  AgentEvent,
  Artifact,
  ArtifactId,
  DepKind,
} from '../../src/contracts/index.js';
import {
  DependencyGraph,
  MAX_NOTICE_HOPS,
  buildDepChangedMessage,
  buildSyncHandoffCard,
  hydrateDependencyGraph,
  inMemoryDependencyStore,
  persistDependency,
} from '../../src/orchestrator/index.js';

function artifact(
  id: string,
  version: number,
  ownerAgentId: string,
  title?: string,
): Artifact {
  return {
    id: id as ArtifactId,
    kind: 'file',
    title: title ?? id,
    ownerAgentId,
    version,
    createdAt: new Date('2026-05-31T00:00:00Z'),
  };
}

const kindReferences: DepKind = 'references';

describe('DependencyGraph', () => {
  it('addDependency stores both directions and dedupes triples', () => {
    const g = new DependencyGraph();
    expect(g.addDependency('a' as ArtifactId, 'b' as ArtifactId, kindReferences)).toBe(true);
    expect(g.addDependency('a' as ArtifactId, 'b' as ArtifactId, kindReferences)).toBe(false);

    expect(g.getDependencies('a' as ArtifactId)).toEqual([
      { from: 'a', to: 'b', kind: 'references' },
    ]);
    expect(g.getDownstream('b' as ArtifactId)).toEqual([
      { artifactId: 'a', hops: 1, kind: 'references' },
    ]);
  });

  it('refuses self-edges to match the DB CHECK constraint', () => {
    const g = new DependencyGraph();
    expect(g.addDependency('a' as ArtifactId, 'a' as ArtifactId, kindReferences)).toBe(false);
    expect(g.edges()).toEqual([]);
  });

  it('emits zero notices for first-version artifacts', () => {
    const g = new DependencyGraph();
    g.addDependency('downstream' as ArtifactId, 'upstream' as ArtifactId, kindReferences);
    g.recordArtifact(artifact('downstream', 1, 'frontend'));
    const notices = g.onArtifactObserved(artifact('upstream', 1, 'backend'));
    expect(notices).toEqual([]);
  });

  it('emits one notice per direct downstream when an upstream bumps version', () => {
    const g = new DependencyGraph();
    g.recordArtifact(artifact('upstream', 1, 'backend', 'api/login.ts'));
    g.recordArtifact(artifact('d1', 1, 'frontend', 'LoginForm.tsx'));
    g.recordArtifact(artifact('d2', 1, 'tester', 'login.test.ts'));
    g.addDependency('d1' as ArtifactId, 'upstream' as ArtifactId, kindReferences);
    g.addDependency('d2' as ArtifactId, 'upstream' as ArtifactId, kindReferences);

    const notices = g.onArtifactObserved(artifact('upstream', 2, 'backend', 'api/login.ts'));
    expect(notices).toHaveLength(2);
    const downstreamIds = notices.map((n) => n.downstream.artifactId).sort();
    expect(downstreamIds).toEqual(['d1', 'd2']);
    expect(notices[0]?.upstream).toMatchObject({
      artifactId: 'upstream',
      fromVersion: 1,
      toVersion: 2,
      ownerAgentId: 'backend',
    });
    expect(notices[0]?.downstream.hopsFromChange).toBe(1);
  });

  it('caps notices at MAX_NOTICE_HOPS (= 2 per spec 060)', () => {
    expect(MAX_NOTICE_HOPS).toBe(2);
    const g = new DependencyGraph();
    // chain: hop3 → hop2 → hop1 → upstream
    g.recordArtifact(artifact('upstream', 1, 'backend'));
    g.recordArtifact(artifact('hop1', 1, 'a'));
    g.recordArtifact(artifact('hop2', 1, 'b'));
    g.recordArtifact(artifact('hop3', 1, 'c'));
    g.addDependency('hop1' as ArtifactId, 'upstream' as ArtifactId, kindReferences);
    g.addDependency('hop2' as ArtifactId, 'hop1' as ArtifactId, kindReferences);
    g.addDependency('hop3' as ArtifactId, 'hop2' as ArtifactId, kindReferences);

    const notices = g.onArtifactObserved(artifact('upstream', 2, 'backend'));
    const downstreamIds = notices.map((n) => n.downstream.artifactId).sort();
    expect(downstreamIds).toEqual(['hop1', 'hop2']);
    expect(downstreamIds).not.toContain('hop3');
  });

  it('survives a cyclic graph without infinite loops', () => {
    const g = new DependencyGraph();
    g.recordArtifact(artifact('a', 1, 'x'));
    g.recordArtifact(artifact('b', 1, 'y'));
    g.addDependency('a' as ArtifactId, 'b' as ArtifactId, kindReferences);
    g.addDependency('b' as ArtifactId, 'a' as ArtifactId, kindReferences);

    const notices = g.onArtifactObserved(artifact('a', 2, 'x'));
    // `b` depends on `a` so it gets one notice; the cycle back to `a` is
    // suppressed by the `seen` set, so no extra notice for `a` itself.
    expect(notices.map((n) => n.downstream.artifactId)).toEqual(['b']);
  });

  it('< 1s SLA: lookups stay instant on a 200-node graph', () => {
    const g = new DependencyGraph();
    for (let i = 0; i < 200; i++) {
      g.recordArtifact(artifact(`n${i}`, 1, `agent${i % 5}`));
    }
    for (let i = 1; i < 200; i++) {
      g.addDependency(`n${i}` as ArtifactId, 'n0' as ArtifactId, kindReferences);
    }
    const start = performance.now();
    const notices = g.onArtifactObserved(artifact('n0', 2, 'agent0'));
    const elapsed = performance.now() - start;
    expect(notices).toHaveLength(199);
    expect(elapsed).toBeLessThan(50); // generous margin vs the 1000ms SLA
  });

  it('applyEvent dispatches declare_dependency and artifact events', () => {
    const g = new DependencyGraph();
    const declareEvt: AgentEvent = {
      type: 'declare_dependency',
      from: 'd1',
      to: 'u1',
      kind: kindReferences,
    };
    expect(g.applyEvent(declareEvt)).toEqual([]);
    expect(g.edges()).toEqual([{ from: 'd1', to: 'u1', kind: 'references' }]);

    g.recordArtifact(artifact('u1', 1, 'backend'));
    g.recordArtifact(artifact('d1', 1, 'frontend'));
    const notices = g.applyEvent({ type: 'artifact', artifact: artifact('u1', 2, 'backend') });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.downstream.artifactId).toBe('d1');
  });
});

describe('dependency-store', () => {
  it('hydrate replays edges from the store into the graph', async () => {
    const store = inMemoryDependencyStore([
      { fromArtifactId: 'd1' as ArtifactId, toArtifactId: 'u1' as ArtifactId, kind: 'references' },
      { fromArtifactId: 'd2' as ArtifactId, toArtifactId: 'u1' as ArtifactId, kind: 'derives_from' },
    ]);
    const g = new DependencyGraph();
    const added = await hydrateDependencyGraph(g, store);
    expect(added).toBe(2);
    expect(g.getDownstream('u1' as ArtifactId).map((d) => d.artifactId).sort()).toEqual([
      'd1',
      'd2',
    ]);
  });

  it('persistDependency writes through when the edge is new', async () => {
    const store = inMemoryDependencyStore();
    const g = new DependencyGraph();
    await persistDependency(g, store, {
      fromArtifactId: 'd1' as ArtifactId,
      toArtifactId: 'u1' as ArtifactId,
      kind: 'references',
    });
    await persistDependency(g, store, {
      fromArtifactId: 'd1' as ArtifactId,
      toArtifactId: 'u1' as ArtifactId,
      kind: 'references',
    });
    const rows = await store.selectAll();
    expect(rows).toHaveLength(1);
  });
});

describe('dependency-broadcast', () => {
  it('buildDepChangedMessage matches the spec 060 template', () => {
    const g = new DependencyGraph();
    g.recordArtifact(artifact('upstream', 1, 'backend', 'api/login.ts'));
    g.recordArtifact(artifact('d1', 1, 'frontend', 'LoginForm.tsx'));
    g.addDependency('d1' as ArtifactId, 'upstream' as ArtifactId, 'references');
    const [notice] = g.onArtifactObserved(artifact('upstream', 2, 'backend', 'api/login.ts'));
    const message = buildDepChangedMessage(notice!);
    expect(message).toBe(
      '⚠️ @frontend `api/login.ts` changed v1→v2 — your `LoginForm.tsx` may need a sync',
    );
  });

  it('buildSyncHandoffCard surfaces previousAgent.summary and both artifact refs', () => {
    const g = new DependencyGraph();
    g.recordArtifact(artifact('upstream', 1, 'backend', 'api/login.ts'));
    g.recordArtifact(artifact('d1', 1, 'frontend', 'LoginForm.tsx'));
    g.addDependency('d1' as ArtifactId, 'upstream' as ArtifactId, 'references');
    const [notice] = g.onArtifactObserved(artifact('upstream', 2, 'backend', 'api/login.ts'));

    const card = buildSyncHandoffCard({
      notice: notice!,
      changeSummary: 'Renamed `email` parameter to `userEmail`.',
      fullHistoryRef: 'chat://chat-1/message-99',
      id: 'card-fixed',
      now: () => new Date('2026-05-31T00:00:00Z'),
    });
    expect(card.id).toBe('card-fixed');
    expect(card.from).toBe('orchestrator');
    expect(card.to).toBe('frontend');
    expect(card.scenario).toBe('agent_handoff');
    expect(card.previousAgent?.summary).toBe('Renamed `email` parameter to `userEmail`.');
    expect(card.previousAgent?.keyOutputs[0]?.title).toBe('api/login.ts');
    expect(card.relevantArtifacts.map((a) => a.title)).toEqual([
      'api/login.ts',
      'LoginForm.tsx',
    ]);
    expect(card.pinnedMessages).toEqual([]);
  });
});
