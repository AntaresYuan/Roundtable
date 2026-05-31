import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { Db } from '../../src/db/index.js';
import { loadDemoSeed, restoreDemo } from '../../src/lib/demo-restore.js';

describe('demo:restore', () => {
  let client: PGlite;
  let db: Db;

  beforeEach(async () => {
    client = new PGlite();
    const d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder: 'drizzle' });
    db = d as unknown as Db;
  });
  afterEach(async () => client.close());

  it('loads the fixture and inserts every row type', async () => {
    const seed = await loadDemoSeed(
      resolve('tests/fixtures/demo/seed.json'),
    );
    await restoreDemo(db, seed);

    const chatRows = await db.select().from(schema.chats);
    const messageRows = await db.select().from(schema.messages);
    const artifactRows = await db.select().from(schema.artifacts);
    const handoffRows = await db.select().from(schema.handoffs);
    const pinRows = await db.select().from(schema.pinnedMessages);
    const depRows = await db.select().from(schema.artifactDeps);

    expect(chatRows).toHaveLength(seed.chats.length);
    expect(messageRows).toHaveLength(seed.messages.length);
    expect(artifactRows).toHaveLength(seed.artifacts.length);
    expect(handoffRows).toHaveLength(seed.handoffs.length);
    expect(pinRows).toHaveLength(seed.pinnedMessages.length);
    expect(depRows).toHaveLength(seed.artifactDeps.length);

    // The handoff row's `card` jsonb should round-trip with the original id.
    expect(handoffRows[0]?.card?.id).toBe(seed.handoffs[0]?.id);
  });

  it('is idempotent: a second run produces the same final state', async () => {
    const seed = await loadDemoSeed(
      resolve('tests/fixtures/demo/seed.json'),
    );

    await restoreDemo(db, seed);
    const firstChats = await db.select().from(schema.chats);
    const firstMessages = await db.select().from(schema.messages);

    await restoreDemo(db, seed);
    const secondChats = await db.select().from(schema.chats);
    const secondMessages = await db.select().from(schema.messages);

    expect(secondChats.map((c) => c.id).sort()).toEqual(
      firstChats.map((c) => c.id).sort(),
    );
    expect(secondMessages.map((m) => m.id).sort()).toEqual(
      firstMessages.map((m) => m.id).sort(),
    );
  });

  it('cascades on reset: messages from a previous run are not duplicated', async () => {
    const seed = await loadDemoSeed(
      resolve('tests/fixtures/demo/seed.json'),
    );
    await restoreDemo(db, seed);

    // Mutate: add an extra message in the demo chat. The next restore should
    // wipe it because it cascades from chats.
    const chatId = seed.chats[0]!.id;
    const NOISE_ID = '99999999-9999-4999-8999-999999999999';
    await db.insert(schema.messages).values({
      id: NOISE_ID,
      chatId,
      authorType: 'user',
      authorId: seed.users[0]!.id,
      content: 'noise that should be wiped',
      status: 'completed',
    });

    await restoreDemo(db, seed);
    const after = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.chatId, chatId));
    expect(after.map((m) => m.id)).not.toContain(NOISE_ID);
    expect(after).toHaveLength(seed.messages.length);
  });
});
