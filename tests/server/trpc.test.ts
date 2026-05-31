import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import { createTRPCContext } from '../../src/server/context.js';
import { createCaller } from '../../src/server/root.js';
import { resetRateLimitForTests } from '../../src/server/rate-limit.js';
import type { AuthSession } from '../../src/server/auth.js';
import type { Db } from '../../src/db/index.js';

describe('appRouter', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    resetRateLimitForTests();
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: 'drizzle' });
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates a chat and reads it back through tRPC', async () => {
    const userId = '30000000-0000-4000-8000-000000000001';
    await db.insert(users).values({
      id: userId,
      email: 'trpc-smoke@roundtable.local',
      name: 'tRPC Smoke',
    });

    const session: AuthSession = {
      expires: new Date(Date.now() + 60_000).toISOString(),
      user: {
        id: userId,
        email: 'trpc-smoke@roundtable.local',
        name: 'tRPC Smoke',
      },
    };

    const ctx = await createTRPCContext({
      session,
      db: db as unknown as Db,
    });
    const caller = createCaller(ctx);

    const created = await caller.chats.create({
      title: 'tRPC smoke chat',
      workspacePath: './workspaces/trpc-smoke-chat',
    });
    const byId = await caller.chats.byId({ id: created?.id ?? '' });
    const list = await caller.chats.list();

    expect(created?.ownerUserId).toBe(userId);
    expect(byId?.workspacePath).toBe('./workspaces/trpc-smoke-chat');
    expect(list).toHaveLength(1);
  });

  it('rejects unauthenticated callers', async () => {
    const ctx = await createTRPCContext({
      db: db as unknown as Db,
    });
    const caller = createCaller(ctx);

    await expect(caller.chats.list()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
