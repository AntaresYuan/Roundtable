import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../src/contracts/index.js';
import { artifactVersions, artifacts, chats, users } from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';
import { ArtifactWatcher, watchArtifactEvents } from '../../src/orchestrator/index.js';

const ids = {
  user: '41000000-0000-4000-8000-000000000001',
  chat: '41000000-0000-4000-8000-000000000002',
};

describe('ArtifactWatcher', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: 'drizzle' });

    await db.insert(users).values({
      id: ids.user,
      email: 'artifact-watcher@roundtable.local',
    });
    await db.insert(chats).values({
      id: ids.chat,
      ownerUserId: ids.user,
      title: 'Artifact watcher',
      workspacePath: './workspaces/artifact-watcher',
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('buffers create and edit events per path, then emits one code artifact on done', async () => {
    const events: AgentEvent[] = [
      {
        type: 'file_change',
        path: 'src/server/router.ts',
        kind: 'create',
        diff: '+export const router = {};',
      },
      {
        type: 'file_change',
        path: 'src/server/router.ts',
        kind: 'edit',
        diff: '+export const appRouter = router;',
      },
      { type: 'done', finishReason: 'stop' },
    ];

    const output = await watchArtifactEvents(events, {
      db,
      chatId: ids.chat,
      ownerAgentId: 'claude-code',
    });

    const artifactEvents = output.filter((event) => event.type === 'artifact');
    expect(artifactEvents).toHaveLength(1);
    expect(artifactEvents[0]).toMatchObject({
      type: 'artifact',
      artifact: {
        kind: 'code',
        title: 'src/server/router.ts',
        uri: 'src/server/router.ts',
        version: 1,
      },
    });
    expect(output.at(-1)?.type).toBe('done');

    const [stored] = await db.select().from(artifacts);
    expect(stored).toMatchObject({
      kind: 'code',
      currentVersion: 1,
      uri: 'src/server/router.ts',
    });

    const [version] = await db.select().from(artifactVersions);
    expect(version?.parentVersion).toBeNull();
    expect(version?.diff).toContain('create: src/server/router.ts');
    expect(version?.diff).toContain('edit: src/server/router.ts');
  });

  it('increments the artifact version chain across flushes', async () => {
    const watcher = new ArtifactWatcher({
      db,
      chatId: ids.chat,
      ownerAgentId: 'cursor',
    });

    await watcher.accept({
      type: 'file_change',
      path: 'src/app.ts',
      kind: 'create',
      diff: '+first',
    });
    await watcher.flush();
    await watcher.accept({
      type: 'file_change',
      path: 'src/app.ts',
      kind: 'edit',
      diff: '+second',
    });
    const output = await watcher.flush();

    expect(output[0]).toMatchObject({
      artifact: { kind: 'code', uri: 'src/app.ts', version: 2 },
    });

    const [stored] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.uri, 'src/app.ts'));
    expect(stored?.currentVersion).toBe(2);

    const versions = await db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, stored?.id ?? ''));
    expect(versions.map((version) => version.parentVersion)).toEqual([null, 1]);
  });

  it('infers markdown artifacts from single markdown files', async () => {
    const output = await watchArtifactEvents(
      [
        {
          type: 'file_change',
          path: 'docs/plan.md',
          kind: 'create',
          diff: '+# Plan',
        },
        { type: 'done' },
      ],
      { db, chatId: ids.chat, ownerAgentId: 'planner' },
    );

    expect(output).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        artifact: expect.objectContaining({
          kind: 'markdown',
          uri: 'docs/plan.md',
        }),
      }),
    );
  });

  it('groups a multi-file app with an entrypoint into one web_app artifact', async () => {
    const output = await watchArtifactEvents(
      [
        {
          type: 'file_change',
          path: 'app/page.tsx',
          kind: 'create',
          diff: '+export default function Page() {}',
        },
        {
          type: 'file_change',
          path: 'app/layout.tsx',
          kind: 'create',
          diff: '+export default function Layout() {}',
        },
        { type: 'done' },
      ],
      { db, chatId: ids.chat, ownerAgentId: 'v0' },
    );

    const artifactEvents = output.filter((event) => event.type === 'artifact');
    expect(artifactEvents).toHaveLength(1);
    expect(artifactEvents[0]).toMatchObject({
      artifact: {
        kind: 'web_app',
        title: 'app',
        uri: 'app',
      },
    });
  });

  it('emits delete changes as new artifact versions', async () => {
    await watchArtifactEvents(
      [
        {
          type: 'file_change',
          path: 'src/dead.ts',
          kind: 'create',
          diff: '+const dead = true;',
        },
        { type: 'done' },
      ],
      { db, chatId: ids.chat, ownerAgentId: 'fixer' },
    );

    const output = await watchArtifactEvents(
      [
        {
          type: 'file_change',
          path: 'src/dead.ts',
          kind: 'delete',
          diff: '-const dead = true;',
        },
        { type: 'done' },
      ],
      { db, chatId: ids.chat, ownerAgentId: 'fixer' },
    );

    expect(output).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        artifact: expect.objectContaining({ version: 2 }),
      }),
    );
  });
});
