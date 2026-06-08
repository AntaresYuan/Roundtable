import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getDbTurn,
  listLocalTurns,
  listDbTurns,
  saveDbTurn,
  saveLocalTurn,
} from '../../src/server/local-turn-store.js';
import type { LocalTurn } from '../../src/server/local-turn-store.js';
import type { Artifact } from '../../src/contracts/index.js';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { chats, users, workbenches } from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import type { Db } from '../../src/db/index.js';

describe('listLocalTurns', () => {
  let rootDir: string;
  let previousStore: string | undefined;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'roundtable-turn-store-'));
    previousStore = process.env['ROUNDTABLE_LOCAL_TURN_STORE'];
    process.env['ROUNDTABLE_LOCAL_TURN_STORE'] = join(rootDir, 'local-turns.json');
  });

  afterEach(async () => {
    if (previousStore === undefined) {
      delete process.env['ROUNDTABLE_LOCAL_TURN_STORE'];
    } else {
      process.env['ROUNDTABLE_LOCAL_TURN_STORE'] = previousStore;
    }
    await rm(rootDir, { recursive: true, force: true });
  });

  it('returns empty array when store does not exist yet', async () => {
    expect(await listLocalTurns()).toEqual([]);
    expect(await listLocalTurns('chat-x')).toEqual([]);
  });

  it('scopes turns by chatId (spec 100 §7 invariant 2)', async () => {
    await saveLocalTurn(turn('turn-a', 'chat-1'));
    await saveLocalTurn(turn('turn-b', 'chat-2'));
    await saveLocalTurn(turn('turn-c', 'chat-1'));

    const chat1 = await listLocalTurns('chat-1');
    expect(chat1.map((t) => t.id).sort()).toEqual(['turn-a', 'turn-c']);

    const chat2 = await listLocalTurns('chat-2');
    expect(chat2.map((t) => t.id)).toEqual(['turn-b']);

    const all = await listLocalTurns();
    expect(all).toHaveLength(3);
  });

  it('returns all turns when chatId is not provided (backward compat)', async () => {
    await saveLocalTurn(turn('turn-1', 'chat-a'));
    await saveLocalTurn(turn('turn-2', 'chat-b'));
    expect(await listLocalTurns()).toHaveLength(2);
  });

  it('returns empty array for a chatId with no matching turns', async () => {
    await saveLocalTurn(turn('turn-1', 'chat-a'));
    expect(await listLocalTurns('chat-z')).toEqual([]);
  });

  it('excludes turns with no localChatId when filtering by chatId', async () => {
    await saveLocalTurn(turn('turn-tagged', 'chat-1'));
    await saveLocalTurn(turn('turn-untagged'));
    expect(await listLocalTurns('chat-1')).toHaveLength(1);
    expect(await listLocalTurns()).toHaveLength(2);
  });
});

describe('DB-backed live turns', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: 'drizzle' });
    await seedChats(db);
  });

  afterEach(async () => {
    await client.close();
  });

  it('persists live turns by real chat id and keeps other chats isolated', async () => {
    await saveDbTurn(db as unknown as Db, CHAT_A, richTurn('turn-db-a', CHAT_A));
    await saveDbTurn(db as unknown as Db, CHAT_B, richTurn('turn-db-b', CHAT_B));

    const chatA = await listDbTurns(db as unknown as Db, CHAT_A);
    const chatB = await listDbTurns(db as unknown as Db, CHAT_B);

    expect(chatA.map((t) => t.id)).toEqual(['turn-db-a']);
    expect(chatA[0]?.localChatId).toBe(CHAT_A);
    expect(chatA[0]?.plan?.tasks).toHaveLength(1);
    expect(chatA[0]?.artifacts).toHaveLength(1);
    expect(chatB.map((t) => t.id)).toEqual(['turn-db-b']);
  });

  it('updates an existing DB turn without duplicating history', async () => {
    await saveDbTurn(db as unknown as Db, CHAT_A, richTurn('turn-db-update', CHAT_A));
    await saveDbTurn(db as unknown as Db, CHAT_A, {
      ...richTurn('turn-db-update', CHAT_A),
      needsApproval: false,
      approvalStatus: 'approved',
      approvedAt: new Date('2026-06-07T12:00:00Z').toISOString(),
    });

    const turns = await listDbTurns(db as unknown as Db, CHAT_A);
    const turn = await getDbTurn(db as unknown as Db, 'turn-db-update');
    expect(turns).toHaveLength(1);
    expect(turn?.approvalStatus).toBe('approved');
    expect(turn?.approvedAt).toBe('2026-06-07T12:00:00.000Z');
  });
});

function turn(id: string, localChatId?: string): LocalTurn {
  return {
    id,
    localChatId,
    message: `Message for ${id}`,
    status: 'done',
    createdAt: new Date().toISOString(),
  };
}

const USER_ID = '91000000-0000-4000-8000-000000000001';
const WORKBENCH_ID = '91000000-0000-4000-8000-000000000002';
const CHAT_A = '91000000-0000-4000-8000-000000000003';
const CHAT_B = '91000000-0000-4000-8000-000000000004';

async function seedChats(db: ReturnType<typeof drizzle<typeof schema>>) {
  await db.insert(users).values({
    id: USER_ID,
    email: 'live-turn-store@roundtable.local',
  });
  await db.insert(workbenches).values({
    id: WORKBENCH_ID,
    ownerUserId: USER_ID,
    name: 'Live turn test',
    workspacePath: '/tmp/live-turn-test',
  });
  await db.insert(chats).values([
    {
      id: CHAT_A,
      ownerUserId: USER_ID,
      workbenchId: WORKBENCH_ID,
      title: 'Chat A',
    },
    {
      id: CHAT_B,
      ownerUserId: USER_ID,
      workbenchId: WORKBENCH_ID,
      title: 'Chat B',
    },
  ]);
}

function richTurn(id: string, localChatId: string): LocalTurn {
  return {
    id,
    localChatId,
    message: `Message for ${id}`,
    status: 'done',
    createdAt: new Date('2026-06-07T10:00:00Z').toISOString(),
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    pmMessage: 'I drafted a one-task plan.',
    needsApproval: true,
    approvalStatus: 'pending',
    intake: {
      intentType: 'build',
      clarity: 'clear',
      ambiguityScore: 0,
      complexity: 'single_agent',
      risk: 'low',
      suggestedRoles: ['implementer'],
      userVisibleSummary: 'Build a small thing.',
    },
    plan: {
      id: `${id}-plan`,
      createdAt: new Date('2026-06-07T10:00:01Z'),
      tasks: [
        {
          id: 'T1',
          title: 'Implement the requested thing',
          assignee: '@implementer',
          deps: [],
          user_visible: true,
          status: 'pending',
        },
      ],
    },
    artifacts: [
      {
        id: `plan-${id}` as Artifact['id'],
        kind: 'spec',
        title: `plans/${id}.json`,
        ownerAgentId: 'orchestrator',
        version: 1,
        preview: '{}',
        createdAt: new Date('2026-06-07T10:00:01Z'),
      },
    ],
  };
}
