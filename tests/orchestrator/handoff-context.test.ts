import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/index.js';
import {
  chats,
  users,
  workbenches,
  workbenchPinnedMessages,
} from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import { composeHandoffContext } from '../../src/orchestrator/handoff-context.js';
import { initialState } from '../../src/orchestrator/state.js';

const USER_ID = '71000000-0000-4000-8000-000000000001';
const WORKBENCH_A = '71000000-0000-4000-8000-0000000000a1';
const WORKBENCH_B = '71000000-0000-4000-8000-0000000000a2';
const CHAT_A = '71000000-0000-4000-8000-000000000011';
const CHAT_B = '71000000-0000-4000-8000-000000000022';

describe('composeHandoffContext', () => {
  let client: PGlite;
  let db: Db;

  beforeEach(async () => {
    client = new PGlite();
    const drizzleDb = drizzle(client, { schema });
    await migrate(drizzleDb, { migrationsFolder: 'drizzle' });
    db = drizzleDb as unknown as Db;

    await db.insert(users).values({
      id: USER_ID,
      email: 'handoff-context@roundtable.local',
      name: 'Context Test',
    });
    await db.insert(workbenches).values([
      {
        id: WORKBENCH_A,
        ownerUserId: USER_ID,
        name: 'Context A',
        workspacePath: `/tmp/context-${randomUUID()}`,
      },
      {
        id: WORKBENCH_B,
        ownerUserId: USER_ID,
        name: 'Context B',
        workspacePath: `/tmp/context-${randomUUID()}`,
      },
    ]);
    await db.insert(chats).values([
      {
        id: CHAT_A,
        ownerUserId: USER_ID,
        workbenchId: WORKBENCH_A,
        title: 'Context A chat',
      },
      {
        id: CHAT_B,
        ownerUserId: USER_ID,
        workbenchId: WORKBENCH_B,
        title: 'Context B chat',
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('includes workbench pins from the current chat workbench only', async () => {
    await db.insert(workbenchPinnedMessages).values([
      {
        id: '71000000-0000-4000-8000-000000000101',
        workbenchId: WORKBENCH_A,
        content: 'Project A rule.',
        pinnedByUserId: USER_ID,
        position: 0,
      },
      {
        id: '71000000-0000-4000-8000-000000000102',
        workbenchId: WORKBENCH_B,
        content: 'Project B secret.',
        pinnedByUserId: USER_ID,
        position: 0,
      },
    ]);

    const result = await composeHandoffContext({
      db,
      state: initialState(CHAT_A, 'build project A'),
      task: task(),
      role: 'implementer',
    });

    expect(result.pinnedMessages.map((pin) => pin.content)).toEqual([
      'Project A rule.',
    ]);
    expect(result.contextAudit.sources).toContainEqual(
      expect.objectContaining({
        scope: 'workbench',
        kind: 'pinned_message',
        id: '71000000-0000-4000-8000-000000000101',
        included: true,
      }),
    );
    expect(result.contextAudit.sources).not.toContainEqual(
      expect.objectContaining({ id: '71000000-0000-4000-8000-000000000102' }),
    );
  });

  it('compacts selected context before dropping it when the budget is tight', async () => {
    await db.insert(workbenchPinnedMessages).values({
      id: '71000000-0000-4000-8000-000000000201',
      workbenchId: WORKBENCH_A,
      content: 'x'.repeat(400),
      pinnedByUserId: USER_ID,
      position: 0,
    });

    const result = await composeHandoffContext({
      db,
      state: initialState(CHAT_A, 'x'),
      task: task('y'),
      role: 'implementer',
      maxChars: 300,
    });

    expect(result.pinnedMessages).toHaveLength(1);
    expect(result.pinnedMessages[0]?.content).toHaveLength(280);
    expect(result.pinnedMessages[0]?.content.endsWith('...')).toBe(true);
    expect(result.contextAudit.budget.compacted).toBe(true);
    expect(result.contextAudit.budget.usedChars).toBeLessThanOrEqual(300);
    expect(result.contextAudit.sources).toContainEqual(
      expect.objectContaining({
        kind: 'pinned_message',
        included: true,
        compacted: true,
      }),
    );
  });
});

function task(title = 'Do the task') {
  return {
    id: 'T1',
    title,
    assignee: '@implementer',
    deps: [],
    user_visible: true,
    status: 'pending' as const,
  };
}
