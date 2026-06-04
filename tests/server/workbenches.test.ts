import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chats, users, workbenches } from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import type { Db } from '../../src/db/index.js';
import { createTRPCContext } from '../../src/server/context.js';
import { createCaller } from '../../src/server/root.js';
import { resetRateLimitForTests } from '../../src/server/rate-limit.js';
import type { AuthSession } from '../../src/server/auth.js';

const USER_ID = '60000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '60000000-0000-4000-8000-0000000000ff';

async function buildEnv() {
  resetRateLimitForTests();
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'drizzle' });

  await db.insert(users).values([
    { id: USER_ID, email: 'wb-test@roundtable.local', name: 'WB Test' },
    { id: OTHER_USER_ID, email: 'wb-other@roundtable.local', name: 'Other' },
  ]);

  const session: AuthSession = {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: { id: USER_ID, email: 'wb-test@roundtable.local', name: 'WB Test' },
  };
  const ctx = await createTRPCContext({ session, db: db as unknown as Db });
  const caller = createCaller(ctx);
  return { client, db: db as unknown as Db, caller };
}

describe('workbenchesRouter', () => {
  let env: Awaited<ReturnType<typeof buildEnv>>;
  beforeEach(async () => {
    env = await buildEnv();
  });
  afterEach(async () => {
    await env.client.close();
  });

  it('creates a workbench, then a chat under it; chats.byId carries the workbench_id', async () => {
    const wb = await env.caller.workbenches.create({
      name: 'waitlist landing',
      workspacePath: '/tmp/wb-waitlist',
      description: 'project workbench',
    });
    expect(wb?.id).toBeDefined();

    const chat = await env.caller.chats.create({
      title: 'build the landing page',
      workbenchId: wb!.id,
    });
    expect(chat?.workbenchId).toBe(wb!.id);

    const byId = await env.caller.chats.byId({ id: chat!.id });
    expect(byId?.workbenchId).toBe(wb!.id);

    // The dispatch-time workspace resolver reads the workbench row, so the
    // path is recoverable from chat → workbench:
    const [wbRow] = await env.db
      .select({ workspacePath: workbenches.workspacePath })
      .from(workbenches)
      .where(eq(workbenches.id, wb!.id));
    expect(wbRow?.workspacePath).toBe('/tmp/wb-waitlist');
  });

  it('rejects chat create when the workbench is owned by a different user', async () => {
    await env.db.insert(workbenches).values({
      id: '60000000-0000-4000-8000-0000000000fe',
      ownerUserId: OTHER_USER_ID,
      name: 'someone else\'s workbench',
      workspacePath: '/tmp/wb-other',
    });
    await expect(
      env.caller.chats.create({
        title: 'sneaky chat',
        workbenchId: '60000000-0000-4000-8000-0000000000fe',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('two chats under the same workbench share the workspace path; the dep graph is workbench-shared by design', async () => {
    const wb = await env.caller.workbenches.create({
      name: 'shared project',
      workspacePath: '/tmp/wb-shared',
    });
    const chatA = await env.caller.chats.create({
      title: 'task A',
      workbenchId: wb!.id,
    });
    const chatB = await env.caller.chats.create({
      title: 'task B',
      workbenchId: wb!.id,
    });

    const rows = await env.db
      .select({ id: chats.id, workbenchId: chats.workbenchId })
      .from(chats);
    expect(rows.map((r) => r.workbenchId)).toEqual([wb!.id, wb!.id]);
    expect(new Set([chatA!.id, chatB!.id]).size).toBe(2);
  });
});
