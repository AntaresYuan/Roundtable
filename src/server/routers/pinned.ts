import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { pinnedMessages } from '../../db/index.js';
import { assertChatAccess } from '../access.js';
import { createTRPCRouter, protectedProcedure, protectedRateLimitedProcedure } from '../trpc.js';

export const pinnedRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      return ctx.db
        .select()
        .from(pinnedMessages)
        .where(eq(pinnedMessages.chatId, input.chatId))
        .orderBy(asc(pinnedMessages.position));
    }),

  pin: protectedRateLimitedProcedure
    .input(
      z.object({
        chatId: z.string().uuid(),
        messageId: z.string().uuid(),
        position: z.number().int().min(0).max(9),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      const [pin] = await ctx.db
        .insert(pinnedMessages)
        .values({
          id: randomUUID(),
          chatId: input.chatId,
          messageId: input.messageId,
          pinnedByUserId: ctx.user.id,
          position: input.position,
        })
        .returning();

      ctx.logger.event('message.pinned', {
        chatId: input.chatId,
        messageId: input.messageId,
      });
      return pin;
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
});
