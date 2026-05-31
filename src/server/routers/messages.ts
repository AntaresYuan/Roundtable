import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AgentEventSchema } from '../../contracts/index.js';
import { messages } from '../../db/index.js';
import { assertChatAccess } from '../access.js';
import { createTRPCRouter, protectedProcedure, protectedRateLimitedProcedure } from '../trpc.js';
import { createAgentEventStream } from '../stream.js';

export const messagesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      return ctx.db
        .select()
        .from(messages)
        .where(eq(messages.chatId, input.chatId))
        .orderBy(asc(messages.createdAt));
    }),

  create: protectedRateLimitedProcedure
    .input(
      z.object({
        chatId: z.string().uuid(),
        content: z.string().min(1),
        event: AgentEventSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      const [message] = await ctx.db
        .insert(messages)
        .values({
          id: randomUUID(),
          chatId: input.chatId,
          authorType: 'user',
          authorId: ctx.user.id,
          content: input.content,
          event: input.event,
        })
        .returning();

      ctx.logger.event('message.created', {
        chatId: input.chatId,
        messageId: message?.id,
      });
      return message;
    }),

  stream: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .subscription(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      return createAgentEventStream(input.chatId);
    }),
});
