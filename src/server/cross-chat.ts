import { randomUUID } from 'node:crypto';
import { desc, eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type {
  ArtifactId,
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
import { artifacts, handoffs, messages } from '../db/index.js';

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
    .where(eq(handoffs.chatId, chatId))
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
    : await loadArtifactSnapshots(db, refIds);

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
    const card: HandoffCard = {
      ...portable.card,
      id: importedHandoffId,
      scenario: 'cross_chat',
      generatedBy: 'orchestrator',
      createdAt: now(),
      fullHistoryRef: `imported:${portable.sourceChatId}:${portable.card.fullHistoryRef}`,
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

async function loadArtifactSnapshots(
  db: Db,
  ids: ArtifactId[],
): Promise<InlinedArtifact[]> {
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
    .where(inArray(artifacts.id, ids as unknown as string[]));

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

function buildImportNotice(portable: PortableHandoffCard): string {
  const intent = portable.card.userIntent.slice(0, 120);
  return [
    `🔄 Context imported from chat \`${portable.sourceChatId}\``,
    `(intent: "${intent}"; ${portable.inlinedArtifacts.length} artifact(s) carried over).`,
    `The next dispatch will pick up this hand-off.`,
  ].join(' ');
}
