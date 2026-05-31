import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { chats } from '../../db/index.js';
import { createTRPCRouter, protectedProcedure, protectedRateLimitedProcedure } from '../trpc.js';

export const chatsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(chats)
      .where(eq(chats.ownerUserId, ctx.user.id))
      .orderBy(desc(chats.updatedAt)),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [chat] = await ctx.db
        .select()
        .from(chats)
        .where(and(eq(chats.id, input.id), eq(chats.ownerUserId, ctx.user.id)));
      return chat ?? null;
    }),

  create: protectedRateLimitedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(160),
        workspacePath: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [chat] = await ctx.db
        .insert(chats)
        .values({
          id: randomUUID(),
          ownerUserId: ctx.user.id,
          title: input.title,
          workspacePath: input.workspacePath,
        })
        .returning();

      ctx.logger.event('chat.created', { chatId: chat?.id });
      return chat;
    }),
});
