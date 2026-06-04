import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { users, workbenches, workflows } from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import type { Db } from '../../src/db/index.js';
import { createTRPCContext } from '../../src/server/context.js';
import { createCaller } from '../../src/server/root.js';
import { resetRateLimitForTests } from '../../src/server/rate-limit.js';
import { resolveWorkbenchWorkflow } from '../../src/server/routers/workflows.js';
import type { AuthSession } from '../../src/server/auth.js';
import type { Workflow } from '../../src/contracts/index.js';

const USER_ID = '80000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '80000000-0000-4000-8000-0000000000ff';
const BUILTIN_ID = '00000000-0000-4000-8000-00000000aaaa';

async function buildEnv() {
  resetRateLimitForTests();
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'drizzle' });

  await db.insert(users).values([
    { id: USER_ID, email: 'wf@roundtable.local', name: 'WF Test' },
    { id: OTHER_USER_ID, email: 'wf-other@roundtable.local', name: 'Other' },
  ]);

  const session: AuthSession = {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: { id: USER_ID, email: 'wf@roundtable.local', name: 'WF Test' },
  };
  const ctx = await createTRPCContext({ session, db: db as unknown as Db });
  const caller = createCaller(ctx);
  return { client, db: db as unknown as Db, caller };
}

describe('workflowsRouter', () => {
  let env: Awaited<ReturnType<typeof buildEnv>>;
  beforeEach(async () => {
    env = await buildEnv();
  });
  afterEach(async () => {
    await env.client.close();
  });

  it('lists the seeded built-in workflow first', async () => {
    const list = await env.caller.workflows.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
    const builtin = list.find((w) => w.id === BUILTIN_ID);
    expect(builtin).toBeDefined();
    expect(builtin?.builtin).toBe(true);
    expect(builtin?.origin).toBe('builtin');
    expect((builtin?.definition as Workflow).name).toBe('Ship a PR-ready feature');
  });

  it('forks a built-in into a user-owned workflow', async () => {
    const fork = await env.caller.workflows.fork({
      sourceId: BUILTIN_ID,
      name: 'My ship workflow',
    });
    expect(fork?.builtin).toBe(false);
    expect(fork?.origin).toBe('fork');
    expect(fork?.fromWorkflowId).toBe(BUILTIN_ID);
    expect(fork?.ownerUserId).toBe(USER_ID);
    expect((fork?.definition as Workflow).origin).toMatchObject({
      kind: 'fork',
      from: BUILTIN_ID,
    });
  });

  it('binds a forked workflow to a workbench and resolveWorkbenchWorkflow returns it', async () => {
    const wb = await env.caller.workbenches.create({
      name: 'Project alpha',
      workspacePath: '/tmp/wf-alpha',
    });
    const fork = await env.caller.workflows.fork({
      sourceId: BUILTIN_ID,
      workbenchId: wb!.id,
    });
    await env.caller.workflows.bindToWorkbench({
      workflowId: fork!.id,
      workbenchId: wb!.id,
    });

    const resolved = await resolveWorkbenchWorkflow(env.db, wb!.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(fork!.id);
    expect(resolved!.origin).toMatchObject({ kind: 'fork', from: BUILTIN_ID });
  });

  it('returns null from resolveWorkbenchWorkflow when no workflow is bound', async () => {
    const wb = await env.caller.workbenches.create({
      name: 'Project beta',
      workspacePath: '/tmp/wf-beta',
    });
    const resolved = await resolveWorkbenchWorkflow(env.db, wb!.id);
    expect(resolved).toBeNull();
  });

  it('rejects update of a built-in workflow', async () => {
    await expect(
      env.caller.workflows.update({ id: BUILTIN_ID, name: 'hack' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects fork/bind when workbench is owned by a different user', async () => {
    await env.db.insert(workbenches).values({
      id: '80000000-0000-4000-8000-0000000000ee',
      ownerUserId: OTHER_USER_ID,
      name: "someone else's workbench",
      workspacePath: '/tmp/wf-other',
    });
    await expect(
      env.caller.workflows.fork({
        sourceId: BUILTIN_ID,
        workbenchId: '80000000-0000-4000-8000-0000000000ee',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('cascades workflow deletion when its bound workbench is deleted', async () => {
    const wb = await env.caller.workbenches.create({
      name: 'cascade test',
      workspacePath: '/tmp/wf-cascade',
    });
    const fork = await env.caller.workflows.fork({
      sourceId: BUILTIN_ID,
      workbenchId: wb!.id,
    });
    await env.db.delete(workbenches).where(eq(workbenches.id, wb!.id));
    const [row] = await env.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, fork!.id));
    expect(row).toBeUndefined();
  });
});
