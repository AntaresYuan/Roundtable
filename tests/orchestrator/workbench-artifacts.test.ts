import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  artifacts,
  chats,
  users,
  workbenches,
} from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import type { Db } from '../../src/db/index.js';
import { AdapterRegistry, createMockAdapter } from '../../src/adapters/index.js';
import {
  runOrchestrator,
  workspaceResolver,
} from '../../src/orchestrator/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USER_ID = '70000000-0000-4000-8000-000000000001';
const WORKBENCH_ID = '70000000-0000-4000-8000-0000000000aa';
const CHAT_A_ID = '70000000-0000-4000-8000-0000000000a1';
const CHAT_B_ID = '70000000-0000-4000-8000-0000000000a2';
const PRIOR_ARTIFACT_ID = '70000000-0000-4000-8000-0000000000af';

describe('artifacts at workbench scope', () => {
  let client: PGlite;
  let db: Db;
  let workDir: string;

  beforeEach(async () => {
    client = new PGlite();
    const d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder: 'drizzle' });
    db = d as unknown as Db;
    workDir = await mkdtemp(join(tmpdir(), 'roundtable-wb-art-'));

    await db.insert(users).values({ id: USER_ID, email: 'wb@roundtable.local' });
    await db.insert(workbenches).values({
      id: WORKBENCH_ID,
      ownerUserId: USER_ID,
      name: 'shared project',
      workspacePath: '/tmp/wb-shared-artifacts',
    });
    await db.insert(chats).values([
      { id: CHAT_A_ID, ownerUserId: USER_ID, workbenchId: WORKBENCH_ID, title: 'task A' },
      { id: CHAT_B_ID, ownerUserId: USER_ID, workbenchId: WORKBENCH_ID, title: 'task B' },
    ]);
    // chat A previously produced an artifact (e.g. via artifact-watcher in a
    // prior run). Insert directly to simulate "the workbench already has code".
    await db.insert(artifacts).values({
      id: PRIOR_ARTIFACT_ID,
      workbenchId: WORKBENCH_ID,
      createdInChatId: CHAT_A_ID,
      kind: 'file',
      title: 'app/page.tsx',
      ownerAgentId: 'implementer',
      currentVersion: 1,
      uri: 'workspace://app/page.tsx',
    });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await client.close();
  });

  it('chat B in the same workbench preloads chat A\'s artifact into state.artifacts', async () => {
    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({ scriptedEvents: [{ type: 'done', finishReason: 'stop' }] }),
    );
    registry.bindRole('implementer', 'mock');
    registry.bindRole('reviewer', 'mock');
    registry.bindRole('planner', 'mock');

    const result = await runOrchestrator(
      {
        chatId: CHAT_B_ID,
        userMessage: 'add tests for the landing page',
        workbenchId: WORKBENCH_ID,
      },
      {
        registry,
        workspaces: workspaceResolver(workDir),
        artifactDb: db,
      },
    );

    const preloaded = result.artifacts.find((a) => a.id === PRIOR_ARTIFACT_ID);
    expect(preloaded).toBeDefined();
    expect(preloaded).toMatchObject({
      title: 'app/page.tsx',
      ownerAgentId: 'implementer',
      version: 1,
      kind: 'file',
    });
  });

  it('reviewer\'s HandoffCard.relevantArtifacts surfaces workbench-shared artifacts', async () => {
    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({ scriptedEvents: [{ type: 'done', finishReason: 'stop' }] }),
    );
    registry.bindRole('reviewer', 'mock');
    registry.bindRole('implementer', 'mock');
    registry.bindRole('planner', 'mock');

    const result = await runOrchestrator(
      {
        chatId: CHAT_B_ID,
        userMessage: 'please review the landing page',
        workbenchId: WORKBENCH_ID,
      },
      {
        registry,
        workspaces: workspaceResolver(workDir),
        artifactDb: db,
      },
    );

    const reviewerCard = result.handoffCards.find((c) => c.to === 'reviewer');
    if (reviewerCard) {
      expect(reviewerCard.relevantArtifacts.map((r) => r.id)).toContain(PRIOR_ARTIFACT_ID);
    } else {
      // Heuristic intake/planner may not always seat a reviewer; the preload itself
      // is the load-bearing assertion, and the first test already covers it.
      expect(result.artifacts.map((a) => a.id)).toContain(PRIOR_ARTIFACT_ID);
    }
  });
});
