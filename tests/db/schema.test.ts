import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Artifact, HandoffCard } from '../../src/contracts/index.js';
import {
  agentSessions,
  artifactDeps,
  artifactVersions,
  artifacts,
  chats,
  customAgents,
  handoffs,
  messages,
  pinnedMessages,
  users,
  workbenches,
} from '../../src/db/schema.js';
import * as schema from '../../src/db/schema.js';

describe('database schema', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: 'drizzle' });
  });

  afterEach(async () => {
    await client.close();
  });

  it('round-trips one of each Roundtable entity', async () => {
    const ids = {
      user: '10000000-0000-4000-8000-000000000001',
      chat: '10000000-0000-4000-8000-000000000002',
      message: '10000000-0000-4000-8000-000000000003',
      artifact: '10000000-0000-4000-8000-000000000004',
      artifactVersion: '10000000-0000-4000-8000-000000000005',
      dependencyTarget: '10000000-0000-4000-8000-000000000006',
      dependencyVersion: '10000000-0000-4000-8000-000000000007',
      handoff: '10000000-0000-4000-8000-000000000008',
      session: '10000000-0000-4000-8000-000000000009',
      pin: '10000000-0000-4000-8000-000000000010',
      customAgent: '10000000-0000-4000-8000-000000000011',
      workbench: '10000000-0000-4000-8000-000000000012',
    };

    await db.insert(users).values({
      id: ids.user,
      email: 'schema-test@roundtable.local',
      name: 'Schema Test',
    });

    await db.insert(workbenches).values({
      id: ids.workbench,
      ownerUserId: ids.user,
      name: 'Schema smoke workbench',
      workspacePath: './workspaces/schema-smoke-test',
    });

    await db.insert(chats).values({
      id: ids.chat,
      ownerUserId: ids.user,
      workbenchId: ids.workbench,
      title: 'Schema smoke test',
    });

    await db.insert(messages).values({
      id: ids.message,
      chatId: ids.chat,
      authorType: 'user',
      authorId: ids.user,
      content: 'Create one of each entity.',
    });

    const sourceArtifact: Artifact = {
      id: ids.artifact as Artifact['id'],
      kind: 'file',
      title: 'Generated page',
      ownerAgentId: 'mock-implementer',
      version: 1,
      uri: 'app/page.tsx',
      createdAt: new Date(),
    };
    const targetArtifact: Artifact = {
      id: ids.dependencyTarget as Artifact['id'],
      kind: 'doc',
      title: 'Requirements',
      ownerAgentId: 'mock-planner',
      version: 1,
      uri: 'docs/requirements.md',
      createdAt: new Date(),
    };

    await db.insert(artifacts).values([
      {
        id: sourceArtifact.id,
        workbenchId: ids.workbench,
        createdInChatId: ids.chat,
        kind: sourceArtifact.kind,
        title: sourceArtifact.title,
        ownerAgentId: sourceArtifact.ownerAgentId,
        currentVersion: sourceArtifact.version,
        uri: sourceArtifact.uri,
      },
      {
        id: targetArtifact.id,
        workbenchId: ids.workbench,
        createdInChatId: ids.chat,
        kind: targetArtifact.kind,
        title: targetArtifact.title,
        ownerAgentId: targetArtifact.ownerAgentId,
        currentVersion: targetArtifact.version,
        uri: targetArtifact.uri,
      },
    ]);

    await db.insert(artifactVersions).values([
      {
        id: ids.artifactVersion,
        artifactId: ids.artifact,
        version: 1,
        snapshot: sourceArtifact,
        createdByAgentId: sourceArtifact.ownerAgentId,
      },
      {
        id: ids.dependencyVersion,
        artifactId: ids.dependencyTarget,
        version: 1,
        snapshot: targetArtifact,
        createdByAgentId: targetArtifact.ownerAgentId,
      },
    ]);

    await db.insert(artifactDeps).values({
      fromArtifactId: ids.artifact,
      toArtifactId: ids.dependencyTarget,
      kind: 'references',
    });

    const handoffCard: HandoffCard = {
      id: ids.handoff,
      from: 'orchestrator',
      to: 'implementer',
      scenario: 'dispatch',
      userIntent: 'Create one of each entity.',
      taskBrief: 'Implement the schema smoke test.',
      pinnedMessages: [
        {
          id: ids.message,
          content: 'Keep the schema boring.',
          pinnedBy: ids.user,
        },
      ],
      rolesInGroup: [],
      relevantArtifacts: [
        {
          id: targetArtifact.id,
          kind: targetArtifact.kind,
          title: targetArtifact.title,
          uri: targetArtifact.uri,
        },
      ],
      fullHistoryRef: `chat:${ids.chat}`,
      createdAt: new Date(),
      generatedBy: 'orchestrator',
    };

    await db.insert(handoffs).values({
      id: ids.handoff,
      chatId: ids.chat,
      from: handoffCard.from,
      to: handoffCard.to,
      scenario: handoffCard.scenario,
      userIntent: handoffCard.userIntent,
      taskBrief: handoffCard.taskBrief,
      pinnedMessages: handoffCard.pinnedMessages,
      relevantArtifacts: handoffCard.relevantArtifacts,
      card: handoffCard,
      fullHistoryRef: handoffCard.fullHistoryRef,
    });

    await db.insert(agentSessions).values({
      id: ids.session,
      chatId: ids.chat,
      adapterId: 'mock',
      role: 'implementer',
      cwd: './workspaces/schema-smoke-test',
      status: 'completed',
    });

    await db.insert(pinnedMessages).values({
      id: ids.pin,
      chatId: ids.chat,
      messageId: ids.message,
      pinnedByUserId: ids.user,
      position: 0,
    });

    await db.insert(customAgents).values({
      id: ids.customAgent,
      ownerUserId: ids.user,
      displayName: 'Schema Test Implementer',
      role: 'implementer',
      systemPrompt: 'Emit canonical AgentEvent values.',
      capabilities: {
        streaming: true,
        toolUse: true,
        fileEdits: true,
        persistentSessions: false,
        mcp: false,
        multimodal: false,
      },
    });

    const [chat] = await db.select().from(chats).where(eq(chats.id, ids.chat));
    const [handoff] = await db
      .select()
      .from(handoffs)
      .where(eq(handoffs.id, ids.handoff));
    const [version] = await db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.id, ids.artifactVersion));
    const [customAgent] = await db
      .select()
      .from(customAgents)
      .where(eq(customAgents.id, ids.customAgent));

    expect(chat?.workbenchId).toBe(ids.workbench);
    expect(handoff?.card.taskBrief).toBe('Implement the schema smoke test.');
    expect(version?.snapshot.title).toBe('Generated page');
    expect(customAgent?.capabilities.fileEdits).toBe(true);
  });

  it('enforces the pinned-message cap at the database layer', async () => {
    const userId = '20000000-0000-4000-8000-000000000001';
    const chatId = '20000000-0000-4000-8000-000000000002';
    const messageId = '20000000-0000-4000-8000-000000000003';
    const workbenchId = '20000000-0000-4000-8000-000000000010';

    await db.insert(users).values({
      id: userId,
      email: 'pin-cap@roundtable.local',
    });
    await db.insert(workbenches).values({
      id: workbenchId,
      ownerUserId: userId,
      name: 'Pin cap workbench',
      workspacePath: './workspaces/pin-cap-test',
    });
    await db.insert(chats).values({
      id: chatId,
      ownerUserId: userId,
      workbenchId,
      title: 'Pin cap test',
    });
    await db.insert(messages).values({
      id: messageId,
      chatId,
      authorType: 'user',
      authorId: userId,
      content: 'This message can be pinned.',
    });

    await expect(
      db.insert(pinnedMessages).values({
        id: '20000000-0000-4000-8000-000000000004',
        chatId,
        messageId,
        pinnedByUserId: userId,
        position: 10,
      }),
    ).rejects.toThrow();
  });
});
