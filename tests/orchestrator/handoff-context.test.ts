import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/index.js';
import {
  chats,
  userProfiles,
  users,
  userSkills,
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

  it('appends the user default brief as a snapshot in taskBrief', async () => {
    await db.insert(userProfiles).values({
      userId: USER_ID,
      defaultBrief: 'Prefer server components and avoid client-side submit JS.',
      defaultSkills: ['nextjs-app-router'],
      notes: 'Personal preference.',
    });

    const result = await composeHandoffContext({
      db,
      state: initialState(CHAT_A, 'build project A'),
      task: task('Create a waitlist form.'),
      role: 'implementer',
    });

    expect(result.taskBrief).toBe(
      [
        'Create a waitlist form.',
        '',
        'User preferences:',
        'Prefer server components and avoid client-side submit JS.',
      ].join('\n'),
    );
    expect(result.contextAudit.sources).toContainEqual(
      expect.objectContaining({
        scope: 'user',
        kind: 'default_brief',
        id: USER_ID,
        included: true,
      }),
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

  it('mounts a user skill when its trigger_hint keyword matches the task (#100)', async () => {
    await db.insert(userSkills).values({
      id: '71000000-0000-4000-8000-000000000301',
      ownerUserId: USER_ID,
      name: 'server-action form submit',
      triggerHint: 'form submit, waitlist signup',
      body: 'Use Next.js server actions for form submit; do not pull in client fetch.',
    });

    const result = await composeHandoffContext({
      db,
      state: initialState(CHAT_A, 'build a waitlist signup form'),
      task: task('Scaffold the waitlist form'),
      role: 'implementer',
    });

    expect(result.taskBrief).toContain('Mounted skill');
    expect(result.taskBrief).toContain('server-action form submit');
    expect(result.contextAudit.sources).toContainEqual(
      expect.objectContaining({
        kind: 'mounted_skill',
        scope: 'user',
        included: true,
        label: 'skill: server-action form submit',
      }),
    );
  });

  it('does NOT mount a user skill whose trigger_hint does not match (no opaque recall)', async () => {
    await db.insert(userSkills).values({
      id: '71000000-0000-4000-8000-000000000302',
      ownerUserId: USER_ID,
      name: 'graphql resolver pattern',
      triggerHint: 'graphql, resolver, apollo',
      body: 'Use DataLoader to batch nested resolver queries.',
    });

    const result = await composeHandoffContext({
      db,
      state: initialState(CHAT_A, 'add a landing page hero section'),
      task: task('Build the hero'),
      role: 'implementer',
    });

    expect(result.taskBrief).not.toContain('graphql resolver pattern');
    const skillSource = result.contextAudit.sources.find(
      (s) => s.kind === 'mounted_skill',
    );
    expect(skillSource).toBeUndefined();
  });

  it('spec 100 invariant 5: updating user_profile after a HandoffCard is composed does NOT retroactively change it (snapshot-on-compose)', async () => {
    // Compose a HandoffCard with the user profile at version "v1".
    await db.insert(userProfiles).values({
      userId: USER_ID,
      defaultBrief: 'v1: prefer server components',
    });

    const first = await composeHandoffContext({
      db,
      state: initialState(CHAT_A, 'build a feature'),
      task: task('Initial composition'),
      role: 'implementer',
    });

    expect(first.taskBrief).toContain('v1: prefer server components');
    expect(first.taskBrief).not.toContain('v2');
    const firstSnapshot = first.taskBrief;

    // User edits their profile mid-run. The composed card already in flight
    // must NOT be mutated. Spec 100 invariant 5: "mutating a higher-scope
    // value affects new dispatches only; in-flight runs keep the snapshot
    // they started with."
    await db
      .update(userProfiles)
      .set({ defaultBrief: 'v2: prefer client components' })
      .where(eq(userProfiles.userId, USER_ID));

    // Snapshot integrity: nothing about `first` should have changed.
    expect(first.taskBrief).toBe(firstSnapshot);
    expect(first.taskBrief).toContain('v1: prefer server components');
    expect(first.taskBrief).not.toContain('v2: prefer client components');

    // Sanity: a *new* composition picks up the v2 brief (downward inheritance
    // is automatic but only at compose time, not retroactive).
    const second = await composeHandoffContext({
      db,
      state: initialState(CHAT_A, 'build a feature'),
      task: task('Second composition after profile update'),
      role: 'implementer',
    });
    expect(second.taskBrief).toContain('v2: prefer client components');
  });

  it('only mounts skills owned by the chat owner (no cross-user leak)', async () => {
    const OTHER_USER = '71000000-0000-4000-8000-0000000000ee';
    await db.insert(users).values({
      id: OTHER_USER,
      email: 'someone-else@roundtable.local',
    });
    await db.insert(userSkills).values({
      id: '71000000-0000-4000-8000-000000000303',
      ownerUserId: OTHER_USER,
      name: "other user's secret",
      triggerHint: 'waitlist',
      body: 'leaked content',
    });

    const result = await composeHandoffContext({
      db,
      state: initialState(CHAT_A, 'build a waitlist landing page'),
      task: task('Scaffold the waitlist page'),
      role: 'implementer',
    });

    expect(result.taskBrief).not.toContain('leaked content');
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
