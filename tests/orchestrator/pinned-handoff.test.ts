import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry, createMockAdapter } from '../../src/adapters/index.js';
import {
  inMemoryHandoffLog,
  workspaceResolver,
} from '../../src/orchestrator/index.js';
import { runDispatch } from '../../src/orchestrator/nodes/dispatch.js';
import { initialState } from '../../src/orchestrator/state.js';
import type { PinnedMessage } from '../../src/contracts/index.js';

const PINS: PinnedMessage[] = [
  { id: 'p1', content: 'CSV export must work without auth', pinnedBy: 'user-1' },
  { id: 'p2', content: 'Use React, not Vue', pinnedBy: 'user-1' },
];

describe('runDispatch — pinnedLoader integration (#64)', () => {
  let rootDir: string;
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'roundtable-pinned-'));
  });
  afterEach(async () => rm(rootDir, { recursive: true, force: true }));

  it('flows pinnedLoader output into every emitted HandoffCard', async () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter());
    registry.bindRole('implementer', 'mock');

    const loader = vi.fn().mockResolvedValue(PINS);
    const state = withPlan(['@implementer', '@implementer']);

    const result = await runDispatch(state, {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
      pinnedLoader: loader,
    });

    // Loader is called once per dispatch turn (not once per task) so pinned
    // context stays consistent across the cards emitted in the same turn.
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(state.chatId);

    expect(result.handoffCards).toHaveLength(2);
    for (const card of result.handoffCards) {
      expect(card.pinnedMessages.map((p) => p.id)).toEqual(['p1', 'p2']);
    }
  });

  it('defaults pinnedMessages to [] when no loader is provided (back-compat)', async () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter());
    registry.bindRole('implementer', 'mock');

    const result = await runDispatch(withPlan(['@implementer']), {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
    });

    expect(result.handoffCards[0]?.pinnedMessages).toEqual([]);
  });
});

function withPlan(assignees: string[]) {
  return {
    ...initialState('chat/pinned', 'build a page'),
    stage: 'dispatch' as const,
    plan: {
      id: 'plan-pinned',
      createdAt: new Date(),
      tasks: assignees.map((assignee, i) => ({
        id: `T${i + 1}`,
        title: `Task ${i + 1}`,
        assignee,
        deps: [],
        user_visible: true,
        status: 'pending' as const,
      })),
    },
  };
}
