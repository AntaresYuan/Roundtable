import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ChatId } from '../../contracts/index.js';
import { handoffs } from '../../db/index.js';
import { assertChatAccess } from '../access.js';
import { buildPortableCard, injectPortableCard } from '../cross-chat.js';
import {
  createTRPCRouter,
  protectedProcedure,
  protectedRateLimitedProcedure,
} from '../trpc.js';

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

  /**
   * Demo scenario 4 from spec 030: export this chat's latest dispatch
   * handoff as a self-contained `PortableHandoffCard`. The returned JSON is
   * what the UI's "Export context" button hands to the clipboard / download.
   */
  export: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      const portable = await buildPortableCard(ctx.db, input.chatId as ChatId);
      ctx.logger.event('handoff.exported', {
        chatId: input.chatId,
        cardId: portable.card.id,
        artifactCount: portable.inlinedArtifacts.length,
      });
      return portable;
    }),

  /**
   * Demo scenario 4 import side: take a portable card, validate it, insert
   * it into the target chat's handoff table, and post a system message so
   * the user sees the context arrived. Does not trigger dispatch directly —
   * the orchestrator's next turn on the target chat sees the new row.
   */
  import: protectedRateLimitedProcedure
    .input(
      z.object({
        chatId: z.string().uuid(),
        exported: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      const result = await injectPortableCard(
        ctx.db,
        input.chatId as ChatId,
        input.exported,
      );
      ctx.logger.event('handoff.imported', {
        chatId: input.chatId,
        handoffId: result.handoffId,
        sourceChatId: result.sourceChatId,
      });
      return result;
    }),
});
