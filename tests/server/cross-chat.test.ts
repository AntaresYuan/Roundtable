import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { ArtifactId, ArtifactRef, ChatId } from '../../src/contracts/index.js';
import {
  artifacts,
  artifactVersions,
  chats,
  handoffs,
  messages,
  users,
} from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import type { Db } from '../../src/db/index.js';
import { createTRPCContext } from '../../src/server/context.js';
import { createCaller } from '../../src/server/root.js';
import { resetRateLimitForTests } from '../../src/server/rate-limit.js';
import type { AuthSession } from '../../src/server/auth.js';
import { fallbackHandoffCard } from '../../src/orchestrator/handoff.js';
import { initialState } from '../../src/orchestrator/state.js';

const USER_ID = '50000000-0000-4000-8000-000000000001';
const CHAT_A = '50000000-0000-4000-8000-0000000000aa';
const CHAT_B = '50000000-0000-4000-8000-0000000000bb';
const ARTIFACT_ID = '50000000-0000-4000-8000-0000000000af';

async function buildEnv() {
  resetRateLimitForTests();
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'drizzle' });

  await db.insert(users).values({
    id: USER_ID,
    email: 'cross-chat@roundtable.local',
    name: 'Cross-chat',
  });
  await db.insert(chats).values([
    {
      id: CHAT_A,
      ownerUserId: USER_ID,
      title: 'source chat',
      workspacePath: `/tmp/cc-a-${randomUUID()}`,
    },
    {
      id: CHAT_B,
      ownerUserId: USER_ID,
      title: 'target chat',
      workspacePath: `/tmp/cc-b-${randomUUID()}`,
    },
  ]);

  const session: AuthSession = {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: { id: USER_ID, email: 'cross-chat@roundtable.local', name: 'Cross-chat' },
  };
  const ctx = await createTRPCContext({ session, db: db as unknown as Db });
  const caller = createCaller(ctx);
  return { client, db: db as unknown as Db, caller };
}

/**
 * Use the real `fallbackHandoffCard` from #39 to build a HandoffCard, then
 * insert it into the source chat's handoff table so `export` has something
 * real to find. This mirrors what `dispatch.ts` does in prod, minus the
 * adapter call — perfect for an end-to-end cross-chat test.
 */
async function seedRealHandoffCard(db: Db, chatId: string): Promise<string> {
  const state = initialState(chatId, 'Build a login page');
  const card = fallbackHandoffCard({
    state,
    task: {
      id: 'T1',
      title: 'Implement /api/login endpoint',
      assignee: 'implementer',
      deps: [],
      parallel: false,
      user_visible: true,
      status: 'pending',
    },
    role: 'implementer',
    relevantArtifacts: [
      { id: ARTIFACT_ID as ArtifactId, kind: 'file', title: 'api/login.ts' },
    ],
  });
  await db.insert(handoffs).values({
    id: card.id,
    chatId,
    from: card.from,
    to: card.to,
    scenario: card.scenario,
    userIntent: card.userIntent,
    taskBrief: card.taskBrief,
    pinnedMessages: card.pinnedMessages,
    rolesInGroup: card.rolesInGroup,
    relevantArtifacts: card.relevantArtifacts,
    card,
    fullHistoryRef: card.fullHistoryRef,
    generatedBy: card.generatedBy,
  });
  return card.id;
}

async function seedArtifact(db: Db, chatId: string): Promise<void> {
  await db.insert(artifacts).values({
    id: ARTIFACT_ID,
    chatId,
    kind: 'file',
    title: 'api/login.ts',
    ownerAgentId: 'backend-agent',
    currentVersion: 2,
    uri: 'workspace://api/login.ts',
    preview: 'export async function login(req) { ... }',
  });
}

describe('handoffs.export', () => {
  let env: Awaited<ReturnType<typeof buildEnv>>;
  beforeEach(async () => {
    env = await buildEnv();
  });
  afterEach(async () => env.client.close());

  it('returns a portable card with cross_chat scenario + inlined artifacts', async () => {
    await seedArtifact(env.db, CHAT_A);
    const handoffId = await seedRealHandoffCard(env.db, CHAT_A);

    const portable = await env.caller.handoffs.export({ chatId: CHAT_A });
    expect(portable.format).toBe('roundtable.portable_handoff');
    expect(portable.version).toBe(1);
    expect(portable.sourceChatId).toBe(CHAT_A);
    expect(portable.card.id).toBe(handoffId);
    expect(portable.card.scenario).toBe('cross_chat');
    expect(portable.inlinedArtifacts).toHaveLength(1);
    expect(portable.inlinedArtifacts[0]).toMatchObject({
      title: 'api/login.ts',
      ownerAgentId: 'backend-agent',
      version: 2,
      uri: 'workspace://api/login.ts',
      preview: 'export async function login(req) { ... }',
    });
  });

  it('does not inline artifacts outside the source chat', async () => {
    await seedArtifact(env.db, CHAT_B);
    await seedRealHandoffCard(env.db, CHAT_A);

    const portable = await env.caller.handoffs.export({ chatId: CHAT_A });
    expect(portable.inlinedArtifacts).toEqual([]);
  });

  it('returns NOT_FOUND when the source chat has no handoffs yet', async () => {
    await expect(env.caller.handoffs.export({ chatId: CHAT_A })).rejects.toThrow(
      TRPCError,
    );
  });
});

describe('handoffs.import', () => {
  let env: Awaited<ReturnType<typeof buildEnv>>;
  beforeEach(async () => {
    env = await buildEnv();
  });
  afterEach(async () => env.client.close());

  it('round-trips: export from A → import into B → handoff row + system message in B', async () => {
    await seedArtifact(env.db, CHAT_A);
    await seedRealHandoffCard(env.db, CHAT_A);

    const portable = await env.caller.handoffs.export({ chatId: CHAT_A });
    const result = await env.caller.handoffs.import({
      chatId: CHAT_B,
      exported: portable,
    });

    expect(result.sourceChatId).toBe(CHAT_A);
    expect(result.handoffId).not.toBe(portable.card.id); // fresh id on import

    const insertedHandoff = await env.db
      .select()
      .from(handoffs)
      .where(eq(handoffs.id, result.handoffId));
    expect(insertedHandoff[0]?.chatId).toBe(CHAT_B);
    expect(insertedHandoff[0]?.scenario).toBe('cross_chat');
    expect(insertedHandoff[0]?.fullHistoryRef).toContain(`imported:${CHAT_A as ChatId}`);

    const importedArtifacts = await env.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.chatId, CHAT_B));
    expect(importedArtifacts).toHaveLength(1);
    expect(importedArtifacts[0]?.id).not.toBe(ARTIFACT_ID);
    expect(importedArtifacts[0]).toMatchObject({
      title: 'api/login.ts',
      ownerAgentId: 'backend-agent',
      currentVersion: 2,
      preview: 'export async function login(req) { ... }',
    });

    const rewrittenRefs = insertedHandoff[0]?.relevantArtifacts as ArtifactRef[];
    expect(rewrittenRefs[0]?.id).toBe(importedArtifacts[0]?.id);
    expect(rewrittenRefs[0]?.id).not.toBe(ARTIFACT_ID);

    const importedVersions = await env.db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, importedArtifacts[0]!.id));
    expect(importedVersions).toHaveLength(1);
    expect(importedVersions[0]?.version).toBe(2);

    const noticeMessage = await env.db
      .select()
      .from(messages)
      .where(eq(messages.id, result.messageId));
    expect(noticeMessage[0]?.chatId).toBe(CHAT_B);
    expect(noticeMessage[0]?.authorType).toBe('system');
    expect(noticeMessage[0]?.content).toContain('Context imported');
  });

  it('rejects an invalid portable card with a Zod error', async () => {
    await expect(
      env.caller.handoffs.import({
        chatId: CHAT_B,
        exported: { not: 'a portable card' },
      }),
    ).rejects.toThrow();

    // Nothing should have landed in B.
    const rows = await env.db
      .select()
      .from(handoffs)
      .where(eq(handoffs.chatId, CHAT_B));
    expect(rows).toHaveLength(0);
  });
});
