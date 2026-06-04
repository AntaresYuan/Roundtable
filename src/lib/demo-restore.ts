import { readFile } from 'node:fs/promises';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import {
  artifactDeps,
  artifacts,
  chats,
  handoffs,
  messages,
  pinnedMessages,
  users,
  workbenches,
} from '../db/schema.js';
import type { HandoffCard } from '../contracts/index.js';
import { HandoffCardSchema } from '../contracts/index.js';

const DemoSeedSchema = z.object({
  users: z.array(z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
  })),
  workbenches: z.array(z.object({
    id: z.string().uuid(),
    ownerUserId: z.string().uuid(),
    name: z.string(),
    description: z.string().optional(),
    workspacePath: z.string(),
  })).default([]),
  chats: z.array(z.object({
    id: z.string().uuid(),
    ownerUserId: z.string().uuid(),
    workbenchId: z.string().uuid(),
    title: z.string(),
  })),
  messages: z.array(z.object({
    id: z.string().uuid(),
    chatId: z.string().uuid(),
    authorType: z.enum(['user', 'orchestrator', 'agent', 'system']),
    authorId: z.string().nullable(),
    content: z.string(),
    status: z.enum(['draft', 'streaming', 'completed', 'failed']).optional(),
  })),
  artifacts: z.array(z.object({
    id: z.string().uuid(),
    workbenchId: z.string().uuid(),
    createdInChatId: z.string().uuid().optional(),
    kind: z.enum(['file', 'diff', 'doc', 'preview', 'note']),
    title: z.string(),
    ownerAgentId: z.string(),
    currentVersion: z.number().int().nonnegative(),
    uri: z.string().optional(),
    preview: z.string().optional(),
  })),
  artifactDeps: z.array(z.object({
    fromArtifactId: z.string().uuid(),
    toArtifactId: z.string().uuid(),
    kind: z.enum(['derives_from', 'replaces', 'references']),
  })),
  handoffs: z.array(HandoffCardSchema.omit({ createdAt: true }).extend({
    chatId: z.string().uuid(),
  })),
  pinnedMessages: z.array(z.object({
    id: z.string().uuid(),
    chatId: z.string().uuid(),
    messageId: z.string().uuid(),
    pinnedByUserId: z.string().uuid(),
    position: z.number().int().min(0).max(9),
  })),
});
export type DemoSeed = z.infer<typeof DemoSeedSchema>;

export async function loadDemoSeed(path: string): Promise<DemoSeed> {
  const raw = await readFile(path, 'utf8');
  return DemoSeedSchema.parse(JSON.parse(raw));
}

export function assertDemoRestoreAllowed(
  databaseUrl = process.env['DATABASE_URL'],
  allowFlag = process.env['ROUNDTABLE_ALLOW_DEMO_RESTORE'],
): void {
  if (allowFlag === 'true' || isLocalDatabaseUrl(databaseUrl)) return;

  throw new Error(
    'Refusing to run demo restore against a non-local DATABASE_URL. Set ROUNDTABLE_ALLOW_DEMO_RESTORE=true to confirm this is a demo environment.',
  );
}

export function isLocalDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return true;
  try {
    const { hostname } = new URL(databaseUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Idempotent demo reset: deletes existing rows for the fixture's workbench
 * ids (after spec 100 / #95 / #96, workbench is the cascade root — drops
 * chats, messages, artifacts, versions, deps, handoffs, pins, sessions in
 * one stroke), then inserts the fixture cleanly. Safe to run repeatedly —
 * each call produces the same final state.
 */
export async function restoreDemo(db: Db, seed: DemoSeed): Promise<void> {
  const chatIds = seed.chats.map((c) => c.id);
  const workbenchIds = seed.workbenches.map((w) => w.id);
  const now = new Date();

  await db.transaction(async (tx) => {
    if (workbenchIds.length > 0) {
      await tx.delete(workbenches).where(inArray(workbenches.id, workbenchIds));
    }
    if (chatIds.length > 0) {
      // Any orphan chats not under our workbenches (legacy / mixed fixtures).
      await tx.delete(chats).where(inArray(chats.id, chatIds));
    }

    for (const user of seed.users) {
      await tx
        .insert(users)
        .values(user)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: user.email,
            name: user.name,
          },
        });
    }
    if (seed.workbenches.length > 0) {
      await tx
        .insert(workbenches)
        .values(
          seed.workbenches.map((wb) => ({
            id: wb.id,
            ownerUserId: wb.ownerUserId,
            name: wb.name,
            workspacePath: wb.workspacePath,
            ...(wb.description !== undefined ? { description: wb.description } : {}),
          })),
        )
        .onConflictDoNothing({ target: workbenches.id });
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
          workbenchId: a.workbenchId,
          ...(a.createdInChatId !== undefined ? { createdInChatId: a.createdInChatId } : {}),
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
