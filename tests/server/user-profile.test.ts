import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthSession } from '../../src/server/auth.js';
import type { Db } from '../../src/db/index.js';
import { users } from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import { createTRPCContext } from '../../src/server/context.js';
import { createCaller } from '../../src/server/root.js';
import { resetRateLimitForTests } from '../../src/server/rate-limit.js';

const USER_ID = '72000000-0000-4000-8000-000000000001';

async function buildCaller() {
  resetRateLimitForTests();
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'drizzle' });
  await db.insert(users).values({
    id: USER_ID,
    email: 'profile-test@roundtable.local',
    name: 'Profile Test',
  });

  const session: AuthSession = {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: USER_ID,
      email: 'profile-test@roundtable.local',
      name: 'Profile Test',
    },
  };
  const ctx = await createTRPCContext({ session, db: db as unknown as Db });
  return { client, caller: createCaller(ctx) };
}

describe('userProfileRouter', () => {
  let env: Awaited<ReturnType<typeof buildCaller>>;

  beforeEach(async () => {
    env = await buildCaller();
  });

  afterEach(async () => {
    await env.client.close();
  });

  it('returns an empty profile when the user has not saved one yet', async () => {
    await expect(env.caller.userProfile.get()).resolves.toMatchObject({
      userId: USER_ID,
      defaultBrief: '',
      defaultSkills: [],
      notes: '',
    });
  });

  it('upserts the user profile and preserves fields omitted in later updates', async () => {
    const first = await env.caller.userProfile.update({
      defaultBrief: 'Prefer server components.',
      defaultSkills: ['nextjs-app-router'],
      notes: 'Keep explanations concise.',
    });

    expect(first).toMatchObject({
      userId: USER_ID,
      defaultBrief: 'Prefer server components.',
      defaultSkills: ['nextjs-app-router'],
      notes: 'Keep explanations concise.',
    });

    const second = await env.caller.userProfile.update({
      notes: 'Updated note only.',
    });

    expect(second).toMatchObject({
      defaultBrief: 'Prefer server components.',
      defaultSkills: ['nextjs-app-router'],
      notes: 'Updated note only.',
    });
  });
});
