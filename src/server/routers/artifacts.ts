import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { artifacts, artifactVersions, chats } from '../../db/index.js';
import { assertChatAccess, assertWorkbenchAccess } from '../access.js';
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
      // Workbench is the canonical scope for artifacts (spec 100 invariant 2);
      // chat may be deleted and `createdInChatId` set to null while the
      // artifact survives at workbench scope.
      if (artifact) await assertWorkbenchAccess(ctx, artifact.workbenchId);
      return artifact ?? null;
    }),

  versions: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [artifact] = await ctx.db
        .select({ workbenchId: artifacts.workbenchId })
        .from(artifacts)
        .where(eq(artifacts.id, input.artifactId));
      if (!artifact) return [];
      await assertWorkbenchAccess(ctx, artifact.workbenchId);
      return ctx.db
        .select()
        .from(artifactVersions)
        .where(eq(artifactVersions.artifactId, input.artifactId));
    }),
});
