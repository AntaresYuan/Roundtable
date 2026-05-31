import { readFile } from 'node:fs/promises';
import { inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import {
  artifactDeps,
  artifacts,
  chats,
  handoffs,
  messages,
  pinnedMessages,
  users,
} from '../db/schema.js';
import type { HandoffCard } from '../contracts/index.js';

export interface DemoSeed {
  users: { id: string; email: string; name: string }[];
  chats: {
    id: string;
    ownerUserId: string;
    title: string;
    workspacePath: string;
  }[];
  messages: {
    id: string;
    chatId: string;
    authorType: 'user' | 'orchestrator' | 'agent' | 'system';
    authorId: string | null;
    content: string;
    status?: 'draft' | 'streaming' | 'completed' | 'failed';
  }[];
  artifacts: {
    id: string;
    chatId: string;
    kind: 'file' | 'diff' | 'doc' | 'preview' | 'note';
    title: string;
    ownerAgentId: string;
    currentVersion: number;
    uri?: string;
    preview?: string;
  }[];
  artifactDeps: {
    fromArtifactId: string;
    toArtifactId: string;
    kind: 'derives_from' | 'replaces' | 'references';
  }[];
  handoffs: (Omit<HandoffCard, 'createdAt'> & { chatId: string })[];
  pinnedMessages: {
    id: string;
    chatId: string;
    messageId: string;
    pinnedByUserId: string;
    position: number;
  }[];
}

export async function loadDemoSeed(path: string): Promise<DemoSeed> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as DemoSeed;
}

/**
 * Idempotent demo reset: deletes existing rows for the fixture's chat ids
 * (cascades to messages / artifacts / handoffs / pins / deps via the
 * schema's `onDelete: cascade`), then inserts the fixture cleanly. Safe to
 * run repeatedly — each call produces the same final state.
 */
export async function restoreDemo(db: Db, seed: DemoSeed): Promise<void> {
  const chatIds = seed.chats.map((c) => c.id);
  const userIds = seed.users.map((u) => u.id);
  const now = new Date();

  await db.transaction(async (tx) => {
    if (chatIds.length > 0) {
      // Cascades through messages / artifacts / handoffs / pinned_messages / agent_sessions.
      await tx.delete(chats).where(inArray(chats.id, chatIds));
    }
    if (userIds.length > 0) {
      await tx.delete(users).where(inArray(users.id, userIds));
    }

    if (seed.users.length > 0) {
      await tx.insert(users).values(seed.users);
    }
    if (seed.chats.length > 0) {
      await tx.insert(chats).values(seed.chats);
    }
    if (seed.messages.length > 0) {
      await tx.insert(messages).values(
        seed.messages.map((m) => ({
          id: m.id,
          chatId: m.chatId,
          authorType: m.authorType,
          authorId: m.authorId,
          content: m.content,
          status: m.status ?? ('completed' as const),
        })),
      );
    }
    if (seed.artifacts.length > 0) {
      await tx.insert(artifacts).values(
        seed.artifacts.map((a) => ({
          id: a.id,
          chatId: a.chatId,
          kind: a.kind,
          title: a.title,
          ownerAgentId: a.ownerAgentId,
          currentVersion: a.currentVersion,
          ...(a.uri !== undefined ? { uri: a.uri } : {}),
          ...(a.preview !== undefined ? { preview: a.preview } : {}),
        })),
      );
    }
    if (seed.artifactDeps.length > 0) {
      await tx.insert(artifactDeps).values(seed.artifactDeps);
    }
    if (seed.handoffs.length > 0) {
      await tx.insert(handoffs).values(
        seed.handoffs.map((h) => {
          const card: HandoffCard = {
            id: h.id,
            from: h.from,
            to: h.to,
            scenario: h.scenario,
            userIntent: h.userIntent,
            taskBrief: h.taskBrief,
            pinnedMessages: h.pinnedMessages,
            rolesInGroup: h.rolesInGroup,
            ...(h.previousAgent !== undefined ? { previousAgent: h.previousAgent } : {}),
            relevantArtifacts: h.relevantArtifacts,
            fullHistoryRef: h.fullHistoryRef,
            createdAt: now,
            generatedBy: h.generatedBy,
          };
          return {
            id: h.id,
            chatId: h.chatId,
            from: h.from,
            to: h.to,
            scenario: h.scenario,
            userIntent: h.userIntent,
            taskBrief: h.taskBrief,
            pinnedMessages: h.pinnedMessages,
            rolesInGroup: h.rolesInGroup,
            relevantArtifacts: h.relevantArtifacts,
            card,
            fullHistoryRef: h.fullHistoryRef,
            generatedBy: h.generatedBy,
            createdAt: now,
          };
        }),
      );
    }
    if (seed.pinnedMessages.length > 0) {
      await tx.insert(pinnedMessages).values(seed.pinnedMessages);
    }
  });
}
