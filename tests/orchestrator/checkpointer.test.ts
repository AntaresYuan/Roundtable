import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { AdapterRegistry, createMockAdapter } from '../../src/adapters/index.js';
import {
  cleanupOldCheckpoints,
  createPostgresCheckpointer,
  resumeOrchestrator,
  runOrchestrator,
  workspaceResolver,
  type PostgresCheckpointerHandle,
} from '../../src/orchestrator/index.js';

// These tests require a live Postgres reachable via DATABASE_URL.
// Boot one with `pnpm dev:services` before running them locally.
const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('Postgres checkpointer', () => {
  let workDir: string;
  let handle: PostgresCheckpointerHandle;
  const testSchema = `rt_test_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'roundtable-pgcp-'));
    const adminPool = new pg.Pool({ connectionString: DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`);
    await adminPool.end();
    handle = await createPostgresCheckpointer({
      connectionString: DATABASE_URL!,
      schema: testSchema,
    });
  }, 30_000);

  afterAll(async () => {
    if (handle) {
      const cleanupPool = new pg.Pool({ connectionString: DATABASE_URL });
      await cleanupPool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await cleanupPool.end();
      await handle.close();
    }
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }, 30_000);

  function deps(checkpointer = handle.saver) {
    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({
        scriptedEvents: [
          { type: 'text_delta', delta: 'working' },
          { type: 'done', finishReason: 'stop' },
        ],
      }),
    );
    registry.bindRole('planner', 'mock');
    registry.bindRole('implementer', 'mock');
    registry.bindRole('reviewer', 'mock');
    return { registry, workspaces: workspaceResolver(workDir), checkpointer };
  }

  it('persists checkpoints so a fresh saver can resume after "restart"', async () => {
    const threadId = `thread-${randomUUID()}`;
    const chatId = `chat-${randomUUID()}`;

    const halted = await runOrchestrator(
      { chatId, threadId, userMessage: 'idk' },
      deps(),
    );
    expect(halted.stage).toBe('clarify');
    expect(halted.clarify?.questions.length).toBeGreaterThan(0);

    // Simulate a process restart: build a brand-new saver against the same DB.
    const reborn = await createPostgresCheckpointer({
      connectionString: DATABASE_URL!,
      schema: testSchema,
      skipSetup: true,
    });
    try {
      const resumed = await resumeOrchestrator(
        { chatId, threadId, clarifyAnswers: { scope: 'prototype' } },
        deps(reborn.saver),
      );
      expect(resumed.stage).toBe('done');
      expect(resumed.clarify?.resolved).toBe(true);
      expect(resumed.aggregate?.headline).toMatch(/Done|Partial/);
    } finally {
      await reborn.close();
    }
  });

  it('cleanupOldCheckpoints removes orphan threads (integration)', async () => {
    const threadId = `orphan-${randomUUID()}`;
    const chatId = `orphan-chat-${randomUUID()}`;

    await runOrchestrator(
      { chatId, threadId, userMessage: 'idk' },
      deps(),
    );

    // No matching `chats` row exists, so this thread is an orphan and should be purged.
    const result = await cleanupOldCheckpoints({
      saver: handle.saver,
      pool: handle.pool,
      olderThanDays: 30,
      schema: testSchema,
    });
    expect(result.deletedThreads).toContain(threadId);

    // After cleanup the thread should no longer have a checkpoint.
    const tuple = await handle.saver.getTuple({
      configurable: { thread_id: threadId },
    });
    expect(tuple).toBeUndefined();
  });
});

describe('cleanupOldCheckpoints (unit)', () => {
  it('calls deleteThread for every row returned by the cutoff query', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ thread_id: 't1' }, { thread_id: 't2' }, { thread_id: 't3' }],
    });
    const deleteThread = vi.fn().mockResolvedValue(undefined);
    const pool = { query } as unknown as pg.Pool;
    const saver = { deleteThread } as unknown as PostgresCheckpointerHandle['saver'];

    const result = await cleanupOldCheckpoints({
      saver,
      pool,
      olderThanDays: 7,
    });

    expect(result.deletedThreads).toEqual(['t1', 't2', 't3']);
    expect(deleteThread).toHaveBeenCalledTimes(3);

    // The cutoff goes into $1 — verify it was computed against `olderThanDays`.
    const [, params] = query.mock.calls[0]!;
    const cutoff = (params as [Date])[0];
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(sevenDaysMs - 1000);
    expect(Date.now() - cutoff.getTime()).toBeLessThanOrEqual(sevenDaysMs + 1000);
  });

  it('defaults to a 30-day cutoff when olderThanDays is omitted', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const deleteThread = vi.fn();
    const pool = { query } as unknown as pg.Pool;
    const saver = { deleteThread } as unknown as PostgresCheckpointerHandle['saver'];

    await cleanupOldCheckpoints({ saver, pool });

    const [, params] = query.mock.calls[0]!;
    const cutoff = (params as [Date])[0];
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(thirtyDaysMs - 1000);
  });
});
