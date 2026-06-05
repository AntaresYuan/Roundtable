import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chats,
  users,
  userSkills,
  workbenches,
} from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import type { Db } from '../../src/db/index.js';
import { createTRPCContext } from '../../src/server/context.js';
import { createCaller } from '../../src/server/root.js';
import { resetRateLimitForTests } from '../../src/server/rate-limit.js';
import type { AuthSession } from '../../src/server/auth.js';

const USER_ID = '90000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '90000000-0000-4000-8000-0000000000ff';

async function buildEnv() {
  resetRateLimitForTests();
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'drizzle' });

  await db.insert(users).values([
    { id: USER_ID, email: 'sk@roundtable.local', name: 'Skill Test' },
    { id: OTHER_USER_ID, email: 'sk-other@roundtable.local', name: 'Other' },
  ]);

  const session: AuthSession = {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: { id: USER_ID, email: 'sk@roundtable.local', name: 'Skill Test' },
  };
  const ctx = await createTRPCContext({ session, db: db as unknown as Db });
  const caller = createCaller(ctx);
  return { client, db: db as unknown as Db, caller };
}

describe('userSkillsRouter', () => {
  let env: Awaited<ReturnType<typeof buildEnv>>;
  beforeEach(async () => {
    env = await buildEnv();
  });
  afterEach(async () => env.client.close());

  it('creates a skill and lists it; PM-propose flow lands here on user save', async () => {
    const skill = await env.caller.userSkills.create({
      name: 'no client JS for submit',
      triggerHint: 'form, submit, server action',
      body: 'When implementing form submission, use server actions instead of client-side fetch.',
    });
    expect(skill).toMatchObject({
      ownerUserId: USER_ID,
      name: 'no client JS for submit',
      triggerHint: 'form, submit, server action',
    });

    const list = await env.caller.userSkills.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(skill!.id);
  });

  it('update preserves fields not in the patch', async () => {
    const skill = await env.caller.userSkills.create({
      name: 'original',
      triggerHint: 'foo',
      body: 'original body',
    });
    const updated = await env.caller.userSkills.update({
      id: skill!.id,
      body: 'updated body',
    });
    expect(updated?.name).toBe('original');
    expect(updated?.triggerHint).toBe('foo');
    expect(updated?.body).toBe('updated body');
  });

  it('delete drops the row', async () => {
    const skill = await env.caller.userSkills.create({
      name: 'doomed',
      triggerHint: 'kw',
      body: 'b',
    });
    const r = await env.caller.userSkills.delete({ id: skill!.id });
    expect(r.count).toBe(1);
    expect(await env.caller.userSkills.list()).toEqual([]);
  });

  it('rejects update of a skill owned by another user', async () => {
    await env.db.insert(userSkills).values({
      id: '90000000-0000-4000-8000-0000000000fe',
      ownerUserId: OTHER_USER_ID,
      name: "someone else's skill",
      triggerHint: 'x',
      body: 'b',
    });
    await expect(
      env.caller.userSkills.update({
        id: '90000000-0000-4000-8000-0000000000fe',
        name: 'hijack',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('unique (owner, name) — same name twice for same user rejects at DB layer', async () => {
    await env.caller.userSkills.create({
      name: 'duplicate',
      triggerHint: 'kw1',
      body: 'b1',
    });
    await expect(
      env.caller.userSkills.create({
        name: 'duplicate',
        triggerHint: 'kw2',
        body: 'b2',
      }),
    ).rejects.toThrow();
  });

  it('source_chat_id audit pointer survives chat deletion (set null)', async () => {
    const wbId = '90000000-0000-4000-8000-0000000000a1';
    const chatId = '90000000-0000-4000-8000-0000000000c1';
    await env.db.insert(workbenches).values({
      id: wbId,
      ownerUserId: USER_ID,
      name: 'wb',
      workspacePath: '/tmp/wb-skill',
    });
    await env.db.insert(chats).values({
      id: chatId,
      ownerUserId: USER_ID,
      workbenchId: wbId,
      title: 'origin chat',
    });
    const skill = await env.caller.userSkills.create({
      name: 'from this chat',
      triggerHint: 'kw',
      body: 'b',
      sourceChatId: chatId,
    });
    expect(skill?.sourceChatId).toBe(chatId);

    await env.db.delete(workbenches).where(eq(workbenches.id, wbId));

    const [row] = await env.db
      .select()
      .from(userSkills)
      .where(eq(userSkills.id, skill!.id));
    expect(row).toBeDefined();
    expect(row?.sourceChatId).toBeNull();
  });
});
