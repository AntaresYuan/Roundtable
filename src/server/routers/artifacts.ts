import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { artifacts, artifactVersions } from '../../db/index.js';
import { assertWorkbenchAccess, chatWorkbenchId } from '../access.js';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';

export const artifactsRouter = createTRPCRouter({
  listByChat: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const workbenchId = await chatWorkbenchId(ctx, input.chatId);
      return ctx.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.workbenchId, workbenchId));
    }),

  listByWorkbench: protectedProcedure
    .input(z.object({ workbenchId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkbenchAccess(ctx, input.workbenchId);
      return ctx.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.workbenchId, input.workbenchId));
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [artifact] = await ctx.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.id, input.id));
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
