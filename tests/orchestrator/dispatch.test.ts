import { stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, createMockAdapter } from '../../src/adapters/index.js';
import type {
  AgentAdapter,
  AgentEvent,
  Artifact,
  ArtifactId,
  PlanTask,
  SessionOpts,
} from '../../src/contracts/index.js';
import type { Db } from '../../src/db/index.js';
import {
  artifacts,
  chats,
  messages,
  pinnedMessages,
  userProfiles,
  users,
  workbenches,
  workbenchPinnedMessages,
} from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import {
  DependencyGraph,
  inMemoryDependencyStore,
  inMemoryHandoffLog,
  workbenchWorkspaceResolver,
  workspaceResolver,
} from '../../src/orchestrator/index.js';
import { runDispatch } from '../../src/orchestrator/nodes/dispatch.js';
import { initialState } from '../../src/orchestrator/state.js';

describe('runDispatch', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'roundtable-dispatch-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('creates the chat workspace before opening an adapter session', async () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter());
    registry.bindRole('implementer', 'mock');

    const state = withPlan('@implementer');
    const result = await runDispatch(state, {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
    });

    const workspace = await stat(join(rootDir, 'chat_1'));
    expect(workspace.isDirectory()).toBe(true);
    expect(result.dispatch[0]?.status).toBe('completed');
  });

  it('resolves adapter cwd from the chat workbench workspace path', { timeout: 10_000 }, async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    const userId = '68000000-0000-4000-8000-000000000001';
    const workbenchId = '68000000-0000-4000-8000-000000000002';
    const chatId = '68000000-0000-4000-8000-000000000003';
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter());
    registry.bindRole('implementer', 'mock');

    try {
      await migrate(db, { migrationsFolder: 'drizzle' });
      await db.insert(users).values({
        id: userId,
        email: 'dispatch-workbench-workspace@roundtable.local',
      });
      await db.insert(workbenches).values({
        id: workbenchId,
        ownerUserId: userId,
        name: 'Dispatch workbench workspace',
        workspacePath: 'projects/shared-workspace',
      });
      await db.insert(chats).values({
        id: chatId,
        ownerUserId: userId,
        workbenchId,
        title: 'Dispatch from workbench workspace',
      });

      const result = await runDispatch(withPlan('@implementer', chatId), {
        registry,
        workspaces: workbenchWorkspaceResolver(db as unknown as Db, rootDir),
        handoffLog: inMemoryHandoffLog(),
      });

      const workspace = await stat(join(rootDir, 'projects/shared-workspace'));
      expect(workspace.isDirectory()).toBe(true);
      expect(result.dispatch[0]?.status).toBe('completed');
    } finally {
      await client.close();
    }
  });

  it('records an unavailable adapter as a failed task instead of throwing', async () => {
    const registry = new AdapterRegistry();
    const state = withPlan('@reviewer');

    const result = await runDispatch(state, {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
    });

    expect(result.dispatch[0]?.status).toBe('failed');
    expect(result.dispatch[0]?.events[0]).toMatchObject({
      type: 'error',
      recoverable: false,
    });
    expect(result.stage).toBe('aggregate');
  });

  it('dispatches independent tasks concurrently and waits before dependent tasks', async () => {
    let active = 0;
    let maxActive = 0;
    const registry = new AdapterRegistry();
    registry.register(
      createTimedAdapter({
        onStart: () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
        },
        onFinish: () => {
          active -= 1;
        },
      }),
    );
    registry.bindRole('implementer', 'timed');
    registry.bindRole('reviewer', 'timed');

    const result = await runDispatch(
      withPlanTasks([
        task('T1', '@implementer'),
        task('T2', '@implementer'),
        task('T3', '@reviewer', ['T1', 'T2']),
      ]),
      {
        registry,
        workspaces: workspaceResolver(rootDir),
        handoffLog: inMemoryHandoffLog(),
      },
    );

    expect(result.dispatch.map((r) => r.taskId)).toEqual(['T1', 'T2', 'T3']);
    expect(result.dispatch.map((r) => r.status)).toEqual([
      'completed',
      'completed',
      'completed',
    ]);
    expect(maxActive).toBe(2);
    expect(result.dispatch[2]!.startedAt.getTime()).toBeGreaterThanOrEqual(
      result.dispatch[0]!.finishedAt!.getTime(),
    );
    expect(result.dispatch[2]!.startedAt.getTime()).toBeGreaterThanOrEqual(
      result.dispatch[1]!.finishedAt!.getTime(),
    );
  });

  it('keeps successful sibling results when a parallel task fails', async () => {
    const registry = new AdapterRegistry();
    registry.register(
      createTimedAdapter({
        eventsByRole: {
          implementer: [
            { type: 'error', message: 'implementation failed', recoverable: false },
          ],
          reviewer: [{ type: 'done', finishReason: 'stop' }],
        },
      }),
    );
    registry.bindRole('implementer', 'timed');
    registry.bindRole('reviewer', 'timed');
    registry.bindRole('fixer', 'timed');

    const result = await runDispatch(
      withPlanTasks([
        task('T1', '@implementer'),
        task('T2', '@reviewer'),
        task('T3', '@fixer', ['T1', 'T2']),
      ]),
      {
        registry,
        workspaces: workspaceResolver(rootDir),
        handoffLog: inMemoryHandoffLog(),
      },
    );

    expect(result.dispatch.map((r) => [r.taskId, r.status])).toEqual([
      ['T1', 'failed'],
      ['T2', 'completed'],
      ['T3', 'failed'],
    ]);
    expect(result.dispatch[2]?.events[0]).toMatchObject({
      type: 'error',
      message: 'dependency failed: T1',
      recoverable: false,
    });
  });

  it('processes dependency declarations and emits sync handoff cards on upstream bumps', async () => {
    const upstreamV1 = artifact('upstream', 1, 'implementer', 'api.ts');
    const downstream = artifact('downstream', 1, 'reviewer', 'consumer.ts');
    const upstreamV2 = artifact('upstream', 2, 'implementer', 'api.ts');
    const script: AgentEvent[] = [
      { type: 'artifact', artifact: upstreamV1 },
      { type: 'artifact', artifact: downstream },
      {
        type: 'declare_dependency',
        from: downstream.id,
        to: upstreamV1.id,
        kind: 'references',
      },
      { type: 'artifact', artifact: upstreamV2 },
      { type: 'done', finishReason: 'stop' },
    ];
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter({ scriptedEvents: script }));
    registry.bindRole('implementer', 'mock');
    const handoffLog = inMemoryHandoffLog();
    const dependencyStore = inMemoryDependencyStore();

    const result = await runDispatch(withPlan('@implementer'), {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog,
      dependencyGraph: new DependencyGraph(),
      dependencyStore,
    });

    expect(await dependencyStore.selectAll()).toEqual([
      {
        fromArtifactId: downstream.id,
        toArtifactId: upstreamV1.id,
        kind: 'references',
      },
    ]);
    expect(result.dispatch[0]?.events).toContainEqual({
      type: 'text_delta',
      delta: '⚠️ @reviewer `api.ts` changed v1→v2 — your `consumer.ts` may need a sync',
    });
    expect(result.handoffCards).toHaveLength(2);
    expect(result.handoffCards[1]).toMatchObject({
      from: 'orchestrator',
      to: 'reviewer',
      scenario: 'agent_handoff',
    });
    expect(handoffLog.entries()).toHaveLength(2);
  });

  it('drains artifact events into state.artifacts as a canonical list', async () => {
    const a1 = artifact('art-1', 1, 'implementer', 'LandingPage.tsx');
    const a2 = artifact('art-2', 1, 'implementer', 'api/waitlist.ts');
    const script: AgentEvent[] = [
      { type: 'artifact', artifact: a1 },
      { type: 'artifact', artifact: a2 },
      { type: 'done', finishReason: 'stop' },
    ];
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter({ scriptedEvents: script }));
    registry.bindRole('implementer', 'mock');

    const result = await runDispatch(withPlan('@implementer'), {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
    });

    expect(result.artifacts).toEqual([a1, a2]);
  });

  it('preserves existing state.artifacts when draining new ones', async () => {
    const existing = artifact('art-existing', 1, 'planner', 'plan.md');
    const fresh = artifact('art-new', 1, 'implementer', 'LandingPage.tsx');
    const script: AgentEvent[] = [
      { type: 'artifact', artifact: fresh },
      { type: 'done', finishReason: 'stop' },
    ];
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter({ scriptedEvents: script }));
    registry.bindRole('implementer', 'mock');

    const seed = withPlan('@implementer');
    const result = await runDispatch(
      { ...seed, artifacts: [existing] },
      {
        registry,
        workspaces: workspaceResolver(rootDir),
        handoffLog: inMemoryHandoffLog(),
      },
    );

    expect(result.artifacts).toEqual([existing, fresh]);
  });

  it('dedupes artifacts by id and version when the same artifact is emitted twice', async () => {
    const v1 = artifact('art-1', 1, 'implementer', 'LandingPage.tsx');
    const v1Dup = artifact('art-1', 1, 'implementer', 'LandingPage.tsx');
    const v2 = artifact('art-1', 2, 'implementer', 'LandingPage.tsx');
    const script: AgentEvent[] = [
      { type: 'artifact', artifact: v1 },
      { type: 'artifact', artifact: v1Dup },
      { type: 'artifact', artifact: v2 },
      { type: 'done', finishReason: 'stop' },
    ];
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter({ scriptedEvents: script }));
    registry.bindRole('implementer', 'mock');

    const result = await runDispatch(withPlan('@implementer'), {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
    });

    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts.map((a) => `${a.id}@${a.version}`)).toEqual([
      'art-1@1',
      'art-1@2',
    ]);
  });

  it('populates relevantArtifacts on reviewer handoffs from state.artifacts (closes specs/080 gap 3)', async () => {
    const a1 = artifact('art-1', 1, 'implementer', 'app/page.tsx');
    const a2 = artifact('art-2', 2, 'implementer', 'app/api/route.ts');
    const a2OldVersion = artifact('art-2', 1, 'implementer', 'app/api/route.ts');
    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({ scriptedEvents: [{ type: 'done', finishReason: 'stop' }] }),
    );
    registry.bindRole('reviewer', 'mock');

    const state = withPlan('@reviewer');
    state.artifacts = [a1, a2OldVersion, a2]; // duplicate id at different versions

    const result = await runDispatch(state, {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
    });

    expect(result.handoffCards[0]?.relevantArtifacts).toEqual([
      { id: a1.id, kind: a1.kind, title: a1.title },
      { id: a2.id, kind: a2.kind, title: a2.title },
    ]);
  });

  it('does not populate relevantArtifacts for implementer handoffs', async () => {
    const a1 = artifact('art-1', 1, 'implementer', 'app/page.tsx');
    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({ scriptedEvents: [{ type: 'done', finishReason: 'stop' }] }),
    );
    registry.bindRole('implementer', 'mock');

    const state = withPlan('@implementer');
    state.artifacts = [a1];

    const result = await runDispatch(state, {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
    });

    expect(result.handoffCards[0]?.relevantArtifacts).toEqual([]);
  });

  it('loads workbench artifacts into reviewer handoffs across chats', { timeout: 15_000 }, async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    const userId = '67000000-0000-4000-8000-000000000001';
    const workbenchId = '67000000-0000-4000-8000-000000000002';
    const sourceChatId = '67000000-0000-4000-8000-000000000003';
    const reviewChatId = '67000000-0000-4000-8000-000000000004';
    const artifactId = '67000000-0000-4000-8000-000000000005' as ArtifactId;
    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({ scriptedEvents: [{ type: 'done', finishReason: 'stop' }] }),
    );
    registry.bindRole('reviewer', 'mock');

    try {
      await migrate(db, { migrationsFolder: 'drizzle' });
      await db.insert(users).values({
        id: userId,
        email: 'dispatch-workbench-artifacts@roundtable.local',
      });
      await db.insert(workbenches).values({
        id: workbenchId,
        ownerUserId: userId,
        name: 'Dispatch workbench artifacts',
        workspacePath: './workspaces/dispatch-workbench-artifacts',
      });
      await db.insert(chats).values([
        {
          id: sourceChatId,
          ownerUserId: userId,
          workbenchId,
          title: 'Source chat',
        },
        {
          id: reviewChatId,
          ownerUserId: userId,
          workbenchId,
          title: 'Review chat',
        },
      ]);
      await db.insert(artifacts).values({
        id: artifactId,
        workbenchId,
        createdInChatId: sourceChatId,
        kind: 'file',
        title: 'src/shared.ts',
        ownerAgentId: 'implementer',
        currentVersion: 3,
        uri: 'src/shared.ts',
      });

      const result = await runDispatch(withPlan('@reviewer', reviewChatId), {
        registry,
        workspaces: workspaceResolver(rootDir),
        handoffLog: inMemoryHandoffLog(),
        artifactDb: db,
      });

      expect(result.artifacts).toContainEqual(
        expect.objectContaining({
          id: artifactId,
          title: 'src/shared.ts',
          version: 3,
        }),
      );
      expect(result.handoffCards[0]?.relevantArtifacts).toEqual([
        {
          id: artifactId,
          kind: 'file',
          title: 'src/shared.ts',
          uri: 'src/shared.ts',
        },
      ]);
    } finally {
      await client.close();
    }
  });

  it('injects workbench and chat pins into generated HandoffCards', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    const userId = '66000000-0000-4000-8000-000000000001';
    const workbenchId = '66000000-0000-4000-8000-000000000002';
    const chatId = '66000000-0000-4000-8000-000000000003';
    const messageId = '66000000-0000-4000-8000-000000000004';
    const chatPinId = '66000000-0000-4000-8000-000000000005';
    const workbenchPinId = '66000000-0000-4000-8000-000000000006';
    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({ scriptedEvents: [{ type: 'done', finishReason: 'stop' }] }),
    );
    registry.bindRole('implementer', 'mock');

    try {
      await migrate(db, { migrationsFolder: 'drizzle' });
      await db.insert(users).values({
        id: userId,
        email: 'dispatch-pins@roundtable.local',
      });
      await db.insert(workbenches).values({
        id: workbenchId,
        ownerUserId: userId,
        name: 'Dispatch pins workbench',
        workspacePath: './workspaces/dispatch-pins',
      });
      await db.insert(chats).values({
        id: chatId,
        ownerUserId: userId,
        workbenchId,
        title: 'Dispatch pins',
      });
      await db.insert(messages).values({
        id: messageId,
        chatId,
        authorType: 'user',
        authorId: userId,
        content: 'Chat pin: validate before submit.',
      });
      await db.insert(workbenchPinnedMessages).values({
        id: workbenchPinId,
        workbenchId,
        content: 'Project pin: use App Router.',
        pinnedByUserId: userId,
        position: 0,
      });
      await db.insert(pinnedMessages).values({
        id: chatPinId,
        chatId,
        messageId,
        pinnedByUserId: userId,
        position: 0,
      });
      await db.insert(userProfiles).values({
        userId,
        defaultBrief: 'Prefer server components.',
        defaultSkills: [],
        notes: '',
      });

      const handoffLog = inMemoryHandoffLog();
      const result = await runDispatch(withPlan('@implementer', chatId), {
        registry,
        workspaces: workspaceResolver(rootDir),
        handoffLog,
        pinnedDb: db as unknown as Db,
      });

      expect(result.handoffCards[0]?.pinnedMessages).toMatchObject([
        { id: workbenchPinId, content: 'Project pin: use App Router.' },
        { id: chatPinId, content: 'Chat pin: validate before submit.' },
      ]);
      expect(result.handoffCards[0]?.taskBrief).toContain(
        'User preferences:\nPrefer server components.',
      );
      expect(result.handoffCards[0]?.contextAudit?.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            scope: 'user',
            kind: 'default_brief',
            id: userId,
            included: true,
          }),
          expect.objectContaining({
            scope: 'workbench',
            kind: 'pinned_message',
            id: workbenchPinId,
            included: true,
          }),
          expect.objectContaining({
            scope: 'chat',
            kind: 'pinned_message',
            id: chatPinId,
            included: true,
          }),
        ]),
      );
      expect(handoffLog.entries()[0]?.context_audit?.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: workbenchPinId, included: true }),
          expect.objectContaining({ id: chatPinId, included: true }),
        ]),
      );
    } finally {
      await client.close();
    }
  });

  it('routes watched artifact bumps into dependency system messages when artifactDb is wired', { timeout: 15_000 }, async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    const chatId = '65000000-0000-4000-8000-000000000001';
    const userId = '65000000-0000-4000-8000-000000000002';
    const upstreamV1 = artifact(
      '65000000-0000-4000-8000-000000000003',
      1,
      'backend',
      'src/api/login.ts',
    );
    const downstream = artifact(
      '65000000-0000-4000-8000-000000000004',
      1,
      'frontend',
      'src/login-form.tsx',
    );
    const upstreamV2 = artifact(
      upstreamV1.id,
      2,
      'backend',
      'src/api/login.ts',
    );
    const script: AgentEvent[] = [
      { type: 'artifact', artifact: upstreamV1 },
      { type: 'artifact', artifact: downstream },
      {
        type: 'declare_dependency',
        from: downstream.id,
        to: upstreamV1.id,
        kind: 'references',
      },
      { type: 'artifact', artifact: upstreamV2 },
      { type: 'done', finishReason: 'stop' },
    ];
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter({ scriptedEvents: script }));
    registry.bindRole('implementer', 'mock');
    const dependencyStore = inMemoryDependencyStore();

    try {
      await migrate(db, { migrationsFolder: 'drizzle' });
      await db.insert(users).values({
        id: userId,
        email: 'dispatch-artifact-watcher@roundtable.local',
      });
      const workbenchId = '65000000-0000-4000-8000-000000000010';
      await db.insert(workbenches).values({
        id: workbenchId,
        ownerUserId: userId,
        name: 'Dispatch artifact watcher workbench',
        workspacePath: './workspaces/dispatch-artifact-watcher',
      });
      await db.insert(chats).values({
        id: chatId,
        ownerUserId: userId,
        workbenchId,
        title: 'Dispatch artifact watcher',
      });

      const result = await runDispatch(withPlan('@implementer', chatId), {
        registry,
        workspaces: workspaceResolver(rootDir),
        handoffLog: inMemoryHandoffLog(),
        dependencyGraph: new DependencyGraph(),
        dependencyStore,
        artifactDb: db,
      });

      expect(result.dispatch[0]?.status).toBe('completed');
      expect(await dependencyStore.selectAll()).toEqual([
        {
          fromArtifactId: downstream.id,
          toArtifactId: upstreamV1.id,
          kind: 'references',
        },
      ]);

      const systemMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId));
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0]).toMatchObject({
        authorType: 'system',
        authorId: 'orchestrator',
        content:
          '⚠️ @frontend `src/api/login.ts` changed v1→v2 — your `src/login-form.tsx` may need a sync',
      });
    } finally {
      await client.close();
    }
  });
});

function withPlan(assignee: string, chatId = 'chat/1') {
  return withPlanTasks([
    {
      id: 'T1',
      title: 'Do the work',
      assignee,
      deps: [],
      user_visible: true,
      status: 'pending' as const,
    },
  ], chatId);
}

function withPlanTasks(tasks: PlanTask[], chatId = 'chat/1') {
  return {
    ...initialState(chatId, 'build a page'),
    stage: 'dispatch' as const,
    plan: {
      id: 'plan-1',
      createdAt: new Date(),
      tasks,
    },
  };
}

function task(id: string, assignee: string, deps: string[] = []): PlanTask {
  return {
    id,
    title: `Do ${id}`,
    assignee,
    deps,
    user_visible: true,
    status: 'pending',
  };
}

function createTimedAdapter(config: {
  onStart?: () => void;
  onFinish?: () => void;
  eventsByRole?: Partial<Record<SessionOpts['role'], AgentEvent[]>>;
  delayMs?: number;
} = {}): AgentAdapter {
  return {
    id: 'timed',
    displayName: 'Timed Agent',
    avatar: 'T',
    capabilities: {
      streaming: true,
      toolUse: false,
      fileEdits: false,
      persistentSessions: false,
      mcp: false,
      multimodal: false,
    },
    async createSession(opts) {
      return {
        id: `timed-${opts.role}-${Date.now()}-${Math.random()}`,
        adapterId: 'timed',
        cwd: opts.cwd,
        async *send() {
          config.onStart?.();
          await sleep(config.delayMs ?? 20);
          config.onFinish?.();
          const events = config.eventsByRole?.[opts.role] ?? [
            { type: 'done' as const, finishReason: 'stop' },
          ];
          yield* events;
        },
        async interrupt() {},
        async close() {},
      };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function artifact(
  id: string,
  version: number,
  ownerAgentId: string,
  title: string,
): Artifact {
  return {
    id: id as ArtifactId,
    kind: 'file',
    title,
    ownerAgentId,
    version,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };
}
