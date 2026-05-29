import { createDbClient } from '../src/db/client.js';
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
} from '../src/db/schema.js';
import type { Artifact, HandoffCard } from '../src/contracts/index.js';

const ids = {
  user: '00000000-0000-4000-8000-000000000001',
  chat: '00000000-0000-4000-8000-000000000002',
  userMessage: '00000000-0000-4000-8000-000000000003',
  agentMessage: '00000000-0000-4000-8000-000000000004',
  artifact: '00000000-0000-4000-8000-000000000005',
  artifactVersion: '00000000-0000-4000-8000-000000000006',
  handoff: '00000000-0000-4000-8000-000000000007',
  session: '00000000-0000-4000-8000-000000000008',
  pin: '00000000-0000-4000-8000-000000000009',
  customAgent: '00000000-0000-4000-8000-000000000010',
  dependencyTarget: '00000000-0000-4000-8000-000000000011',
  dependencyTargetVersion: '00000000-0000-4000-8000-000000000012',
};

async function main() {
  const { db, client } = createDbClient();

  try {
    await db
      .insert(users)
      .values({
        id: ids.user,
        email: 'demo@roundtable.local',
        name: 'Demo User',
      })
      .onConflictDoNothing();

    await db
      .insert(chats)
      .values({
        id: ids.chat,
        ownerUserId: ids.user,
        title: 'Demo project',
        workspacePath: './workspaces/demo-project',
      })
      .onConflictDoNothing();

    await db
      .insert(messages)
      .values([
        {
          id: ids.userMessage,
          chatId: ids.chat,
          authorType: 'user',
          authorId: ids.user,
          content: 'Build a waitlist page with CSV export.',
        },
        {
          id: ids.agentMessage,
          chatId: ids.chat,
          authorType: 'agent',
          authorId: 'mock-implementer',
          content: 'Created the waitlist page artifact.',
        },
      ])
      .onConflictDoNothing();

    const artifactSnapshot: Artifact = {
      id: ids.artifact as Artifact['id'],
      kind: 'file',
      title: 'Waitlist page',
      ownerAgentId: 'mock-implementer',
      version: 1,
      uri: 'app/waitlist/page.tsx',
      createdAt: new Date(),
    };

    const dependencySnapshot: Artifact = {
      id: ids.dependencyTarget as Artifact['id'],
      kind: 'doc',
      title: 'Waitlist requirements',
      ownerAgentId: 'mock-planner',
      version: 1,
      uri: 'docs/waitlist.md',
      createdAt: new Date(),
    };

    await db
      .insert(artifacts)
      .values([
        {
          id: ids.artifact,
          chatId: ids.chat,
          kind: artifactSnapshot.kind,
          title: artifactSnapshot.title,
          ownerAgentId: artifactSnapshot.ownerAgentId,
          currentVersion: artifactSnapshot.version,
          uri: artifactSnapshot.uri,
        },
        {
          id: dependencySnapshot.id,
          chatId: ids.chat,
          kind: dependencySnapshot.kind,
          title: dependencySnapshot.title,
          ownerAgentId: dependencySnapshot.ownerAgentId,
          currentVersion: dependencySnapshot.version,
          uri: dependencySnapshot.uri,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(artifactVersions)
      .values([
        {
          id: ids.artifactVersion,
          artifactId: ids.artifact,
          version: 1,
          snapshot: artifactSnapshot,
          createdByAgentId: artifactSnapshot.ownerAgentId,
        },
        {
          id: ids.dependencyTargetVersion,
          artifactId: ids.dependencyTarget,
          version: 1,
          snapshot: dependencySnapshot,
          createdByAgentId: dependencySnapshot.ownerAgentId,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(artifactDeps)
      .values({
        fromArtifactId: ids.artifact,
        toArtifactId: ids.dependencyTarget,
        kind: 'references',
      })
      .onConflictDoNothing();

    const handoffCard: HandoffCard = {
      id: ids.handoff,
      from: 'orchestrator',
      to: 'implementer',
      scenario: 'dispatch',
      userIntent: 'Build a waitlist page with CSV export.',
      taskBrief: 'Implement scoped code changes',
      pinnedMessages: [
        {
          id: ids.userMessage,
          content: 'CSV export is required for the demo.',
          pinnedBy: ids.user,
        },
      ],
      rolesInGroup: [],
      relevantArtifacts: [
        {
          id: dependencySnapshot.id,
          kind: 'doc',
          title: 'Waitlist requirements',
          uri: 'docs/waitlist.md',
        },
      ],
      fullHistoryRef: `chat:${ids.chat}`,
      createdAt: new Date(),
      generatedBy: 'orchestrator',
    };

    await db
      .insert(handoffs)
      .values({
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
      })
      .onConflictDoNothing();

    await db
      .insert(agentSessions)
      .values({
        id: ids.session,
        chatId: ids.chat,
        adapterId: 'mock',
        role: 'implementer',
        cwd: './workspaces/demo-project',
        status: 'completed',
      })
      .onConflictDoNothing();

    await db
      .insert(pinnedMessages)
      .values({
        id: ids.pin,
        chatId: ids.chat,
        messageId: ids.userMessage,
        pinnedByUserId: ids.user,
        position: 0,
      })
      .onConflictDoNothing();

    await db
      .insert(customAgents)
      .values({
        id: ids.customAgent,
        ownerUserId: ids.user,
        displayName: 'Demo Implementer',
        role: 'implementer',
        systemPrompt: 'Implement scoped code changes and emit AgentEvent values.',
        capabilities: {
          streaming: true,
          toolUse: true,
          fileEdits: true,
          persistentSessions: false,
          mcp: false,
          multimodal: false,
        },
      })
      .onConflictDoNothing();

    console.log('Seeded demo Roundtable data.');
  } finally {
    await client.end();
  }
}

await main();
