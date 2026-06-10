import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { chats, workbenches } from '../../db/index.js';
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
        workbenchId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [workbench] = await ctx.db
        .select({ id: workbenches.id })
        .from(workbenches)
        .where(
          and(
            eq(workbenches.id, input.workbenchId),
            eq(workbenches.ownerUserId, ctx.user.id),
          ),
        );
      if (!workbench) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'workbench not found or not owned by user',
        });
      }

      const [chat] = await ctx.db
        .insert(chats)
        .values({
          id: randomUUID(),
          ownerUserId: ctx.user.id,
          workbenchId: input.workbenchId,
          title: input.title,
        })
        .returning();

      ctx.logger.event('chat.created', { chatId: chat?.id, workbenchId: input.workbenchId });
      return chat;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(chats)
        .where(and(eq(chats.id, input.id), eq(chats.ownerUserId, ctx.user.id)));
      ctx.logger.event('chat.deleted', { chatId: input.id });
      return { ok: true };
    }),
});
