import { asc, eq } from 'drizzle-orm';
import type { PinnedMessage } from '../contracts/index.js';
import type { Db } from '../db/index.js';
import { messages, pinnedMessages } from '../db/index.js';

/**
 * Load every pinned message for `chatId` in the `PinnedMessage` contract
 * shape, ready to be dropped into a `HandoffCard.pinnedMessages` field.
 *
 * Joined with `messages` to inline `content`. Ordered by `position` so the
 * downstream agent sees them in the same order the user pinned them. The
 * DB CHECK constraint already caps positions at < 10, so the array length
 * is implicitly bounded.
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
  const rows = await db
    .select({
      id: pinnedMessages.id,
      content: messages.content,
      pinnedBy: pinnedMessages.pinnedByUserId,
    })
    .from(pinnedMessages)
    .innerJoin(messages, eq(messages.id, pinnedMessages.messageId))
    .where(eq(pinnedMessages.chatId, chatId))
    .orderBy(asc(pinnedMessages.position));

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    pinnedBy: r.pinnedBy,
  }));
}
