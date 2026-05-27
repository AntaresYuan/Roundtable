import { stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, createMockAdapter } from '../../src/adapters/index.js';
import { inMemoryHandoffLog, workspaceResolver } from '../../src/orchestrator/index.js';
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
