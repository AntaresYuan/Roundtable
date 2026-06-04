import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type {
  ArtifactId,
  ArtifactRef,
  ChatId,
  HandoffCard,
  InlinedArtifact,
  PortableHandoffCard,
} from '../contracts/index.js';
import {
  PORTABLE_HANDOFF_VERSION,
  PortableHandoffCardSchema,
} from '../contracts/index.js';
import type { Db } from '../db/index.js';
import { artifacts, artifactVersions, chats, handoffs, messages } from '../db/index.js';

/**
 * Build a self-contained PortableHandoffCard from a chat's most recent
 * dispatch handoff. Inlines artifact snapshots (kind/title/preview/uri +
 * ownerAgentId/version) so the recipient chat doesn't need access to the
 * source's `artifacts` table.
 *
 * Throws `TRPCError({ code: 'NOT_FOUND' })` if the chat has never produced
 * a handoff yet — the UI should surface that as "nothing to export."
 */
export async function buildPortableCard(
  db: Db,
  chatId: ChatId,
  now: () => Date = () => new Date(),
): Promise<PortableHandoffCard> {
  const [row] = await db
    .select({ card: handoffs.card })
    .from(handoffs)
    .where(and(eq(handoffs.chatId, chatId), eq(handoffs.scenario, 'dispatch')))
    .orderBy(desc(handoffs.createdAt))
    .limit(1);

  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'No handoff to export yet — dispatch at least one task first.',
    });
  }

  const original = row.card as HandoffCard;
  const refIds = original.relevantArtifacts.map((a) => a.id as ArtifactId);
  const inlinedArtifacts = refIds.length === 0
    ? []
    : await loadArtifactSnapshots(db, chatId, refIds);

  const exportedCard: HandoffCard = {
    ...original,
    scenario: 'cross_chat',
  };

  return {
    format: 'roundtable.portable_handoff',
    version: PORTABLE_HANDOFF_VERSION,
    sourceChatId: chatId,
    exportedAt: now(),
    card: exportedCard,
    inlinedArtifacts,
  };
}

/**
 * Validate and ingest a portable card into the target chat. Inserts a new
 * row in `handoffs` (fresh id + targetChatId + cross_chat scenario) and a
 * lightweight system message in `messages` flagging the import.
 *
 * Does NOT trigger a dispatch — the orchestrator's next run on this chat
 * will see the freshly-inserted handoff and route accordingly. That keeps
 * the import a pure, replayable side-effect.
 */
export async function injectPortableCard(
  db: Db,
  targetChatId: ChatId,
  raw: unknown,
  now: () => Date = () => new Date(),
): Promise<{ handoffId: string; messageId: string; sourceChatId: ChatId }> {
  const portable = PortableHandoffCardSchema.parse(raw);

  return db.transaction(async (tx) => {
    const importedHandoffId = randomUUID();
    const importedArtifacts = await importInlinedArtifacts(
      tx,
      targetChatId,
      portable,
      now,
    );
    const card: HandoffCard = {
      ...portable.card,
      id: importedHandoffId,
      scenario: 'cross_chat',
      generatedBy: 'orchestrator',
      createdAt: now(),
      fullHistoryRef: `imported:${portable.sourceChatId}:${portable.card.fullHistoryRef}`,
      relevantArtifacts: rewriteArtifactRefs(
        portable.card.relevantArtifacts,
        importedArtifacts,
      ),
    };

    await tx.insert(handoffs).values({
      id: importedHandoffId,
      chatId: targetChatId,
      from: card.from,
      to: card.to,
      scenario: 'cross_chat',
      userIntent: card.userIntent,
      taskBrief: card.taskBrief,
      pinnedMessages: card.pinnedMessages,
      rolesInGroup: card.rolesInGroup,
      relevantArtifacts: card.relevantArtifacts,
      card,
      fullHistoryRef: card.fullHistoryRef,
      generatedBy: card.generatedBy,
      createdAt: card.createdAt,
    });

    const messageId = randomUUID();
    await tx.insert(messages).values({
      id: messageId,
      chatId: targetChatId,
      authorType: 'system',
      authorId: 'orchestrator',
      content: buildImportNotice(portable),
      status: 'completed',
    });

    return {
      handoffId: importedHandoffId,
      messageId,
      sourceChatId: portable.sourceChatId,
    };
  });
}

type ImportedArtifactMap = Map<ArtifactId, ArtifactRef>;

async function importInlinedArtifacts(
  db: Pick<Db, 'insert' | 'select'>,
  targetChatId: ChatId,
  portable: PortableHandoffCard,
  now: () => Date,
): Promise<ImportedArtifactMap> {
  const imported = new Map<ArtifactId, ArtifactRef>();
  const targetWorkbenchId = await workbenchIdForChat(db, targetChatId);

  for (const artifact of portable.inlinedArtifacts) {
    const importedId = randomUUID() as ArtifactId;
    const createdAt = now();
    const uri = `imported:${portable.sourceChatId}:${artifact.uri ?? artifact.id}`;
    const preview = artifact.content ?? artifact.preview;
    const snapshot = {
      id: importedId,
      kind: artifact.kind,
      title: artifact.title,
      ownerAgentId: artifact.ownerAgentId,
      version: artifact.version,
      uri,
      ...(preview !== undefined ? { preview } : {}),
      createdAt,
    };

    await db.insert(artifacts).values({
      id: importedId,
      workbenchId: targetWorkbenchId,
      createdInChatId: targetChatId,
      kind: artifact.kind,
      title: artifact.title,
      ownerAgentId: artifact.ownerAgentId,
      currentVersion: artifact.version,
      uri,
      ...(preview !== undefined ? { preview } : {}),
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(artifactVersions).values({
      id: randomUUID(),
      artifactId: importedId,
      version: artifact.version,
      parentVersion: null,
      snapshot,
      diff: artifact.content ?? artifact.preview ?? null,
      createdByAgentId: artifact.ownerAgentId,
      createdAt,
    });

    imported.set(artifact.id, {
      id: importedId,
      kind: artifact.kind,
      title: artifact.title,
      uri,
    });
  }

  return imported;
}

function rewriteArtifactRefs(
  refs: ArtifactRef[],
  imported: ImportedArtifactMap,
): ArtifactRef[] {
  return refs.map((ref) => imported.get(ref.id as ArtifactId) ?? ref);
}

async function loadArtifactSnapshots(
  db: Db,
  chatId: ChatId,
  ids: ArtifactId[],
): Promise<InlinedArtifact[]> {
  const sourceWorkbenchId = await workbenchIdForChat(db, chatId);
  // `artifacts.id` is `uuid` in the DB; the contract brand `ArtifactId` is
  // just a string, so the cast is safe at the query boundary.
  const rows = await db
    .select({
      id: artifacts.id,
      kind: artifacts.kind,
      title: artifacts.title,
      ownerAgentId: artifacts.ownerAgentId,
      version: artifacts.currentVersion,
      uri: artifacts.uri,
      preview: artifacts.preview,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workbenchId, sourceWorkbenchId),
        inArray(artifacts.id, ids as unknown as string[]),
      ),
    );

  return rows.map((r) => ({
    id: r.id as ArtifactId,
    kind: r.kind,
    title: r.title,
    ownerAgentId: r.ownerAgentId,
    version: r.version,
    ...(r.uri !== null ? { uri: r.uri } : {}),
    ...(r.preview !== null ? { preview: r.preview } : {}),
    // `content` is not stored on the artifacts table directly — body lives
    // in the artifact versions table (when one exists). The exported card
    // carries whatever preview + uri the source had; reconstructing full
    // content is left to a later iteration if the demo proves it's needed.
  }));
}

async function workbenchIdForChat(
  db: Pick<Db, 'select'>,
  chatId: ChatId,
): Promise<string> {
  const [chat] = await db
    .select({ workbenchId: chats.workbenchId })
    .from(chats)
    .where(eq(chats.id, chatId));
  if (!chat) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
  }
  return chat.workbenchId;
}

function buildImportNotice(portable: PortableHandoffCard): string {
  const intent = portable.card.userIntent.slice(0, 120);
  return [
    `🔄 Context imported from chat \`${portable.sourceChatId}\``,
    `(intent: "${intent}"; ${portable.inlinedArtifacts.length} artifact(s) carried over).`,
    `The next dispatch will pick up this hand-off.`,
  ].join(' ');
}
