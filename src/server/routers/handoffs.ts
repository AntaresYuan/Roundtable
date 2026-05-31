import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { handoffs } from '../../db/index.js';
import { assertChatAccess } from '../access.js';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';

export const handoffsRouter = createTRPCRouter({
  listByChat: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      return ctx.db
        .select()
        .from(handoffs)
        .where(eq(handoffs.chatId, input.chatId))
        .orderBy(desc(handoffs.createdAt));
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [handoff] = await ctx.db
        .select()
        .from(handoffs)
        .where(eq(handoffs.id, input.id));
      if (handoff) await assertChatAccess(ctx, handoff.chatId);
      return handoff ?? null;
    }),
});
