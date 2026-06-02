import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { messages, pinnedMessages } from '../../db/index.js';
import type { Db } from '../../db/index.js';
import { assertChatAccess } from '../access.js';
import {
  createTRPCRouter,
  protectedProcedure,
  protectedRateLimitedProcedure,
} from '../trpc.js';

/** Spec 030 § Token-control: global cap of 10 pinned messages per chat. */
export const PIN_CAP_PER_CHAT = 10;

/**
 * Discriminated result returned by `pin` when the chat is already at the
 * cap. The UI shows a confirm dialog with `current` so the user can pick
 * which pin to evict (then call `replacePin`).
 */
export interface PinCapExceeded {
  ok: false;
  error: 'cap_exceeded';
  cap: number;
  current: { id: string; messageId: string; position: number; createdAt: Date }[];
}

export const pinnedRouter = createTRPCRouter({
  /** Read all pins for a chat, ordered by position. */
  list: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      const rows = await ctx.db
        .select({
          id: pinnedMessages.id,
          chatId: pinnedMessages.chatId,
          messageId: pinnedMessages.messageId,
          pinnedByUserId: pinnedMessages.pinnedByUserId,
          position: pinnedMessages.position,
          createdAt: pinnedMessages.createdAt,
          content: messages.content,
        })
        .from(pinnedMessages)
        .innerJoin(
          messages,
          and(
            eq(messages.id, pinnedMessages.messageId),
            eq(messages.chatId, pinnedMessages.chatId),
          ),
        )
        .where(eq(pinnedMessages.chatId, input.chatId))
        .orderBy(asc(pinnedMessages.position));
      return rows;
    }),

  /**
   * Pin a message. Position is auto-assigned to the lowest free slot in
   * [0, PIN_CAP_PER_CHAT). When the cap is hit we DO NOT auto-evict — we
   * return a structured `cap_exceeded` result so the UI can prompt the user
   * to pick which pin to drop (then call `replacePin`).
   */
  pin: protectedRateLimitedProcedure
    .input(
      z.object({
        chatId: z.string().uuid(),
        messageId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);

      return ctx.db.transaction(async (tx) => {
        await assertMessageInChat(tx, input.chatId, input.messageId);

        const existing = await tx
          .select({
            id: pinnedMessages.id,
            messageId: pinnedMessages.messageId,
            position: pinnedMessages.position,
            createdAt: pinnedMessages.createdAt,
          })
          .from(pinnedMessages)
          .where(eq(pinnedMessages.chatId, input.chatId))
          .orderBy(asc(pinnedMessages.position));

        // Already pinned → no-op return.
        const alreadyPinned = existing.find((r) => r.messageId === input.messageId);
        if (alreadyPinned) {
          return {
            ok: true as const,
            pin: { ...alreadyPinned, chatId: input.chatId },
          };
        }

        if (existing.length >= PIN_CAP_PER_CHAT) {
          return {
            ok: false as const,
            error: 'cap_exceeded' as const,
            cap: PIN_CAP_PER_CHAT,
            current: existing,
          };
        }

        const used = new Set(existing.map((r) => r.position));
        let position = 0;
        while (used.has(position) && position < PIN_CAP_PER_CHAT) position += 1;

        const [inserted] = await tx
          .insert(pinnedMessages)
          .values({
            id: randomUUID(),
            chatId: input.chatId,
            messageId: input.messageId,
            pinnedByUserId: ctx.user.id,
            position,
          })
          .returning();

        if (!inserted) {
          throw new Error('pin insert returned no rows');
        }

        ctx.logger.event('message.pinned', {
          chatId: input.chatId,
          messageId: input.messageId,
          position,
        });
        return { ok: true as const, pin: inserted };
      });
    }),

  unpin: protectedRateLimitedProcedure
    .input(z.object({ chatId: z.string().uuid(), messageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      const deleted = await ctx.db
        .delete(pinnedMessages)
        .where(
          and(
            eq(pinnedMessages.chatId, input.chatId),
            eq(pinnedMessages.messageId, input.messageId),
          ),
        )
        .returning();

      ctx.logger.event('message.unpinned', {
        chatId: input.chatId,
        messageId: input.messageId,
      });
      return { count: deleted.length };
    }),

  /**
   * Atomically swap a pin: drop `evictMessageId`, pin `addMessageId` at the
   * freed slot. Used when the user resolves a `cap_exceeded` confirm dialog.
   * Both must be in the same chat or the call is rejected.
   */
  replacePin: protectedRateLimitedProcedure
    .input(
      z.object({
        chatId: z.string().uuid(),
        addMessageId: z.string().uuid(),
        evictMessageId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);

      return ctx.db.transaction(async (tx) => {
        await assertMessageInChat(tx, input.chatId, input.addMessageId);

        const [alreadyPinned] = await tx
          .select()
          .from(pinnedMessages)
          .where(
            and(
              eq(pinnedMessages.chatId, input.chatId),
              eq(pinnedMessages.messageId, input.addMessageId),
            ),
          );
        if (alreadyPinned) {
          return { ok: true as const, pin: alreadyPinned };
        }

        const evicted = await tx
          .delete(pinnedMessages)
          .where(
            and(
              eq(pinnedMessages.chatId, input.chatId),
              eq(pinnedMessages.messageId, input.evictMessageId),
            ),
          )
          .returning({
            id: pinnedMessages.id,
            position: pinnedMessages.position,
          });
        if (evicted.length === 0) {
          return {
            ok: false as const,
            error: 'evict_not_found' as const,
          };
        }
        const freedPosition = evicted[0]!.position;

        const [inserted] = await tx
          .insert(pinnedMessages)
          .values({
            id: randomUUID(),
            chatId: input.chatId,
            messageId: input.addMessageId,
            pinnedByUserId: ctx.user.id,
            position: freedPosition,
          })
          .returning();

        if (!inserted) {
          throw new Error('replacePin insert returned no rows');
        }

        ctx.logger.event('message.pin_replaced', {
          chatId: input.chatId,
          addMessageId: input.addMessageId,
          evictMessageId: input.evictMessageId,
          position: freedPosition,
        });
        return { ok: true as const, pin: inserted };
      });
    }),
});

async function assertMessageInChat(
  db: Pick<Db, 'select'>,
  chatId: string,
  messageId: string,
): Promise<void> {
  const [message] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.chatId, chatId)));

  if (!message) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
  }
}
