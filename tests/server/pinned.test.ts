import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chats, messages, pinnedMessages, users } from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import type { Db } from '../../src/db/index.js';
import { createTRPCContext } from '../../src/server/context.js';
import { createCaller } from '../../src/server/root.js';
import { resetRateLimitForTests } from '../../src/server/rate-limit.js';
import type { AuthSession } from '../../src/server/auth.js';
import { loadPinnedForHandoff } from '../../src/server/pinned-helpers.js';
import { PIN_CAP_PER_CHAT } from '../../src/server/routers/pinned.js';

const USER_ID = '40000000-0000-4000-8000-000000000001';
const CHAT_ID = '40000000-0000-4000-8000-000000000099';
const OTHER_CHAT_ID = '40000000-0000-4000-8000-000000000088';

async function buildCaller() {
  resetRateLimitForTests();
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'drizzle' });

  await db.insert(users).values({
    id: USER_ID,
    email: 'pin-test@roundtable.local',
    name: 'Pin Test',
  });
  await db.insert(chats).values([
    {
      id: CHAT_ID,
      ownerUserId: USER_ID,
      title: 'pin test chat',
      workspacePath: `/tmp/pin-${randomUUID()}`,
    },
    {
      id: OTHER_CHAT_ID,
      ownerUserId: USER_ID,
      title: 'other pin test chat',
      workspacePath: `/tmp/pin-other-${randomUUID()}`,
    },
  ]);

  const session: AuthSession = {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: { id: USER_ID, email: 'pin-test@roundtable.local', name: 'Pin Test' },
  };
  const ctx = await createTRPCContext({ session, db: db as unknown as Db });
  const caller = createCaller(ctx);

  return { client, db: db as unknown as Db, caller };
}

async function insertMessage(
  db: Db,
  content: string,
  chatId = CHAT_ID,
): Promise<string> {
  const id = randomUUID();
  await db.insert(messages).values({
    id,
    chatId,
    authorType: 'user',
    authorId: USER_ID,
    content,
    status: 'completed',
  });
  return id;
}

describe('pinnedRouter', () => {
  let env: Awaited<ReturnType<typeof buildCaller>>;
  beforeEach(async () => {
    env = await buildCaller();
  });
  afterEach(async () => {
    await env.client.close();
  });

  it('PIN_CAP_PER_CHAT is the spec 030 cap of 10', () => {
    expect(PIN_CAP_PER_CHAT).toBe(10);
  });

  it('pin auto-assigns the lowest free position and list returns content', async () => {
    const m1 = await insertMessage(env.db, 'first pin');
    const m2 = await insertMessage(env.db, 'second pin');

    const r1 = await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: m1 });
    const r2 = await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: m2 });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.pin.position).toBe(0);
    expect(r2.pin.position).toBe(1);

    const listed = await env.caller.pinned.list({ chatId: CHAT_ID });
    expect(listed.map((p) => p.content)).toEqual(['first pin', 'second pin']);
  });

  it('pinning the same message twice is a no-op (idempotent)', async () => {
    const m = await insertMessage(env.db, 'dupe');
    const r1 = await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: m });
    const r2 = await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: m });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.pin.id).toBe(r2.pin.id);
    expect((await env.caller.pinned.list({ chatId: CHAT_ID })).length).toBe(1);
  });

  it('rejects pinning a message from another chat', async () => {
    const otherChatMessage = await insertMessage(
      env.db,
      'other chat secret',
      OTHER_CHAT_ID,
    );

    await expect(
      env.caller.pinned.pin({ chatId: CHAT_ID, messageId: otherChatMessage }),
    ).rejects.toThrow('Message not found');

    await expect(env.caller.pinned.list({ chatId: CHAT_ID })).resolves.toEqual([]);
  });

  it('does not surface legacy cross-chat pinned rows when listing pins', async () => {
    const otherChatMessage = await insertMessage(
      env.db,
      'other chat secret',
      OTHER_CHAT_ID,
    );
    await env.db.insert(pinnedMessages).values({
      id: randomUUID(),
      chatId: CHAT_ID,
      messageId: otherChatMessage,
      pinnedByUserId: USER_ID,
      position: 0,
    });

    await expect(env.caller.pinned.list({ chatId: CHAT_ID })).resolves.toEqual([]);
    await expect(loadPinnedForHandoff(env.db, CHAT_ID)).resolves.toEqual([]);
  });

  it('unpin frees a slot so the next pin lands in the hole', async () => {
    const m1 = await insertMessage(env.db, 'a');
    const m2 = await insertMessage(env.db, 'b');
    const m3 = await insertMessage(env.db, 'c');
    await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: m1 });
    await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: m2 });
    await env.caller.pinned.unpin({ chatId: CHAT_ID, messageId: m1 });
    const r3 = await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: m3 });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.pin.position).toBe(0); // the freed slot
  });

  it('11th pin returns cap_exceeded with the current 10 listed', async () => {
    const ids: string[] = [];
    for (let i = 0; i < PIN_CAP_PER_CHAT; i++) {
      const id = await insertMessage(env.db, `pin ${i}`);
      ids.push(id);
      const r = await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: id });
      expect(r.ok).toBe(true);
    }
    const eleventh = await insertMessage(env.db, 'overflow');
    const r = await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: eleventh });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('cap_exceeded');
    expect(r.cap).toBe(PIN_CAP_PER_CHAT);
    expect(r.current).toHaveLength(PIN_CAP_PER_CHAT);
  });

  it('replacePin atomically swaps one pin for another at the freed slot', async () => {
    const m1 = await insertMessage(env.db, 'old');
    const m2 = await insertMessage(env.db, 'new');
    const r1 = await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: m1 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const positionBefore = r1.pin.position;

    const r2 = await env.caller.pinned.replacePin({
      chatId: CHAT_ID,
      addMessageId: m2,
      evictMessageId: m1,
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.pin.position).toBe(positionBefore);

    const listed = await env.caller.pinned.list({ chatId: CHAT_ID });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.content).toBe('new');
  });

  it('rejects replacing with a message from another chat without evicting', async () => {
    const original = await insertMessage(env.db, 'old');
    const otherChatMessage = await insertMessage(
      env.db,
      'other chat replacement',
      OTHER_CHAT_ID,
    );
    await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: original });

    await expect(
      env.caller.pinned.replacePin({
        chatId: CHAT_ID,
        addMessageId: otherChatMessage,
        evictMessageId: original,
      }),
    ).rejects.toThrow('Message not found');

    const listed = await env.caller.pinned.list({ chatId: CHAT_ID });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.messageId).toBe(original);
  });

  it('replacePin is idempotent when the added message is already pinned', async () => {
    const original = await insertMessage(env.db, 'old');
    const alreadyPinned = await insertMessage(env.db, 'already pinned');
    await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: original });
    const existing = await env.caller.pinned.pin({
      chatId: CHAT_ID,
      messageId: alreadyPinned,
    });
    expect(existing.ok).toBe(true);
    if (!existing.ok) return;

    const result = await env.caller.pinned.replacePin({
      chatId: CHAT_ID,
      addMessageId: alreadyPinned,
      evictMessageId: original,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pin.id).toBe(existing.pin.id);
    const listed = await env.caller.pinned.list({ chatId: CHAT_ID });
    expect(listed.map((p) => p.messageId).sort()).toEqual(
      [alreadyPinned, original].sort(),
    );
  });

  it('replacePin returns evict_not_found when the target isn\'t pinned', async () => {
    const m1 = await insertMessage(env.db, 'phantom');
    const m2 = await insertMessage(env.db, 'newcomer');
    const r = await env.caller.pinned.replacePin({
      chatId: CHAT_ID,
      addMessageId: m2,
      evictMessageId: m1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('evict_not_found');
  });
});

describe('loadPinnedForHandoff', () => {
  let env: Awaited<ReturnType<typeof buildCaller>>;
  beforeEach(async () => {
    env = await buildCaller();
  });
  afterEach(async () => {
    await env.client.close();
  });

  it('returns PinnedMessage[] in position order with inlined content', async () => {
    const m1 = await insertMessage(env.db, 'use react');
    const m2 = await insertMessage(env.db, 'deploy via vercel');
    await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: m1 });
    await env.caller.pinned.pin({ chatId: CHAT_ID, messageId: m2 });

    const result = await loadPinnedForHandoff(env.db, CHAT_ID);
    expect(result.map((p) => p.content)).toEqual(['use react', 'deploy via vercel']);
    for (const p of result) {
      expect(p.pinnedBy).toBe(USER_ID);
      expect(p.id).toBeTypeOf('string');
    }
  });

  it('returns [] for a chat with no pins', async () => {
    const result = await loadPinnedForHandoff(env.db, CHAT_ID);
    expect(result).toEqual([]);
  });
});
