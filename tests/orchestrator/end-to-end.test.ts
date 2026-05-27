import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, createMockAdapter } from '../../src/adapters/index.js';
import {
  inMemoryHandoffLog,
  runOrchestrator,
  workspaceResolver,
} from '../../src/orchestrator/index.js';

describe('runOrchestrator end-to-end', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'roundtable-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('drives a build request through plan → dispatch → aggregate', async () => {
    const registry = new AdapterRegistry();
    const mock = createMockAdapter({
      scriptedEvents: [
        { type: 'text_delta', delta: 'starting' },
        {
          type: 'file_change',
          path: 'app/waitlist/page.tsx',
          kind: 'create',
          diff: '+ export default function Page() {}',
        },
        { type: 'done', finishReason: 'stop' },
      ],
    });
    registry.register(mock);
    registry.bindRole('planner', 'mock');
    registry.bindRole('implementer', 'mock');
    registry.bindRole('reviewer', 'mock');

    const log = inMemoryHandoffLog();
    const result = await runOrchestrator(
      { chatId: 'chat-1', userMessage: 'Build a waitlist page with CSV export' },
      {
        registry,
        workspaces: workspaceResolver(workDir),
        handoffLog: log,
      },
    );

    expect(result.stage).toBe('done');
    expect(result.plan?.tasks.length).toBeGreaterThanOrEqual(2);
    expect(result.dispatch.every((d) => d.status === 'completed')).toBe(true);
    expect(result.handoffCards.length).toBe(result.plan?.tasks.length);
    expect(log.entries().length).toBe(result.handoffCards.length);
    expect(result.aggregate?.headline).toMatch(/Done|Partial/);
  });

  it('halts at clarify when message is ambiguous', async () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter());
    registry.bindRole('implementer', 'mock');

    const result = await runOrchestrator(
      { chatId: 'chat-2', userMessage: 'idk' },
      { registry, workspaces: workspaceResolver(workDir) },
    );

    expect(result.stage).toBe('clarify');
    expect(result.clarify?.questions.length).toBeGreaterThan(0);
    expect(result.clarify?.resolved).toBe(false);
  });
});
