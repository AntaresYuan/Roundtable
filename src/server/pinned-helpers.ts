import { and, asc, eq } from 'drizzle-orm';
import type { PinnedMessage } from '../contracts/index.js';
import type { Db } from '../db/index.js';
import {
  chats,
  messages,
  pinnedMessages,
  workbenchPinnedMessages,
} from '../db/index.js';

export const PINNED_HANDOFF_CAP = 10;

/**
 * Load inherited pins for `chatId` in the `PinnedMessage` contract shape,
 * ready to be dropped into a `HandoffCard.pinnedMessages` field.
 *
 * Workbench pins are project-wide constraints; chat pins are task-specific.
 * The HandoffCard displays project pins first, then chat pins. When the
 * merged set exceeds the cap, chat pins win because lower scope is more
 * specific (spec 100).
 *
 * Use from the HandoffCard generator (issue #39) like:
 *
 *     const pinned = await loadPinnedForHandoff(db, chatId);
 *     return { ...card, pinnedMessages: pinned };
 */
export async function loadPinnedForHandoff(
  db: Db,
  chatId: string,
): Promise<PinnedMessage[]> {
  const [chat] = await db
    .select({ workbenchId: chats.workbenchId })
    .from(chats)
    .where(eq(chats.id, chatId));

  const workbenchPins = chat
    ? await db
        .select({
          id: workbenchPinnedMessages.id,
          content: workbenchPinnedMessages.content,
          pinnedBy: workbenchPinnedMessages.pinnedByUserId,
        })
        .from(workbenchPinnedMessages)
        .where(eq(workbenchPinnedMessages.workbenchId, chat.workbenchId))
        .orderBy(asc(workbenchPinnedMessages.position))
    : [];

  const chatPins = await db
    .select({
      id: pinnedMessages.id,
      content: messages.content,
      pinnedBy: pinnedMessages.pinnedByUserId,
    })
    .from(pinnedMessages)
    .innerJoin(
      messages,
      and(
        eq(messages.id, pinnedMessages.messageId),
        eq(messages.chatId, pinnedMessages.chatId),
      ),
    )
    .where(eq(pinnedMessages.chatId, chatId))
    .orderBy(asc(pinnedMessages.position));

  return mergePinnedForHandoff(
    workbenchPins.map(toPinnedMessage),
    chatPins.map(toPinnedMessage),
  );
}

export function mergePinnedForHandoff(
  workbenchPins: PinnedMessage[],
  chatPins: PinnedMessage[],
): PinnedMessage[] {
  const chatSlice = chatPins.slice(0, PINNED_HANDOFF_CAP);
  const remaining = PINNED_HANDOFF_CAP - chatSlice.length;
  return [...workbenchPins.slice(0, remaining), ...chatSlice];
}

function toPinnedMessage(row: {
  id: string;
  content: string;
  pinnedBy: string;
}): PinnedMessage {
  return {
    id: row.id,
    content: row.content,
    pinnedBy: row.pinnedBy,
  };
}
