import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { artifacts, artifactVersions, chats } from '../../db/index.js';
import { assertChatAccess } from '../access.js';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';

export const artifactsRouter = createTRPCRouter({
  listByChat: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId);
      const [chat] = await ctx.db
        .select({ workbenchId: chats.workbenchId })
        .from(chats)
        .where(and(eq(chats.id, input.chatId), eq(chats.ownerUserId, ctx.user.id)));
      if (!chat) return [];
      return ctx.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.workbenchId, chat.workbenchId));
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [artifact] = await ctx.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.id, input.id));
      if (artifact) await assertChatAccess(ctx, artifact.createdInChatId);
      return artifact ?? null;
    }),

  versions: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [artifact] = await ctx.db
        .select({ createdInChatId: artifacts.createdInChatId })
        .from(artifacts)
        .where(eq(artifacts.id, input.artifactId));
      if (!artifact) return [];
      await assertChatAccess(ctx, artifact.createdInChatId);
      return ctx.db
        .select()
        .from(artifactVersions)
        .where(eq(artifactVersions.artifactId, input.artifactId));
    }),
});
