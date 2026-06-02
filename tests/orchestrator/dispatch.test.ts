import { stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, createMockAdapter } from '../../src/adapters/index.js';
import type { AgentEvent, Artifact, ArtifactId } from '../../src/contracts/index.js';
import {
  DependencyGraph,
  inMemoryDependencyStore,
  inMemoryHandoffLog,
  workspaceResolver,
} from '../../src/orchestrator/index.js';
import { runDispatch } from '../../src/orchestrator/nodes/dispatch.js';
import { initialState } from '../../src/orchestrator/state.js';

describe('runDispatch', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'roundtable-dispatch-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('creates the chat workspace before opening an adapter session', async () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter());
    registry.bindRole('implementer', 'mock');

    const state = withPlan('@implementer');
    const result = await runDispatch(state, {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
    });

    const workspace = await stat(join(rootDir, 'chat_1'));
    expect(workspace.isDirectory()).toBe(true);
    expect(result.dispatch[0]?.status).toBe('completed');
  });

  it('records an unavailable adapter as a failed task instead of throwing', async () => {
    const registry = new AdapterRegistry();
    const state = withPlan('@reviewer');

    const result = await runDispatch(state, {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
    });

    expect(result.dispatch[0]?.status).toBe('failed');
    expect(result.dispatch[0]?.events[0]).toMatchObject({
      type: 'error',
      recoverable: false,
    });
    expect(result.stage).toBe('aggregate');
  });

  it('processes dependency declarations and emits sync handoff cards on upstream bumps', async () => {
    const upstreamV1 = artifact('upstream', 1, 'implementer', 'api.ts');
    const downstream = artifact('downstream', 1, 'reviewer', 'consumer.ts');
    const upstreamV2 = artifact('upstream', 2, 'implementer', 'api.ts');
    const script: AgentEvent[] = [
      { type: 'artifact', artifact: upstreamV1 },
      { type: 'artifact', artifact: downstream },
      {
        type: 'declare_dependency',
        from: downstream.id,
        to: upstreamV1.id,
        kind: 'references',
      },
      { type: 'artifact', artifact: upstreamV2 },
      { type: 'done', finishReason: 'stop' },
    ];
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter({ scriptedEvents: script }));
    registry.bindRole('implementer', 'mock');
    const handoffLog = inMemoryHandoffLog();
    const dependencyStore = inMemoryDependencyStore();

    const result = await runDispatch(withPlan('@implementer'), {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog,
      dependencyGraph: new DependencyGraph(),
      dependencyStore,
    });

    expect(await dependencyStore.selectAll()).toEqual([
      {
        fromArtifactId: downstream.id,
        toArtifactId: upstreamV1.id,
        kind: 'references',
      },
    ]);
    expect(result.dispatch[0]?.events).toContainEqual({
      type: 'text_delta',
      delta: '⚠️ @reviewer `api.ts` changed v1→v2 — your `consumer.ts` may need a sync',
    });
    expect(result.handoffCards).toHaveLength(2);
    expect(result.handoffCards[1]).toMatchObject({
      from: 'orchestrator',
      to: 'reviewer',
      scenario: 'agent_handoff',
    });
    expect(handoffLog.entries()).toHaveLength(2);
  });
});

function withPlan(assignee: string) {
  return {
    ...initialState('chat/1', 'build a page'),
    stage: 'dispatch' as const,
    plan: {
      id: 'plan-1',
      createdAt: new Date(),
      tasks: [
        {
          id: 'T1',
          title: 'Do the work',
          assignee,
          deps: [],
          user_visible: true,
          status: 'pending' as const,
        },
      ],
    },
  };
}

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
