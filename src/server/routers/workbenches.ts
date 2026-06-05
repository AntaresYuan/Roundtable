import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { workbenches } from '../../db/index.js';
import { createTRPCRouter, protectedProcedure, protectedRateLimitedProcedure } from '../trpc.js';

/**
 * Workbench = "project" — owns the shared workspace, will own artifacts /
 * workflow / project-pinned in follow-up issues (#96–#98). See spec 100.
 */
export const workbenchesRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(workbenches)
      .where(eq(workbenches.ownerUserId, ctx.user.id))
      .orderBy(desc(workbenches.updatedAt)),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(workbenches)
        .where(
          and(
            eq(workbenches.id, input.id),
            eq(workbenches.ownerUserId, ctx.user.id),
          ),
        );
      return row ?? null;
    }),

  create: protectedRateLimitedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(160),
        workspacePath: z.string().min(1),
        description: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(workbenches)
        .values({
          id: randomUUID(),
          ownerUserId: ctx.user.id,
          name: input.name,
          workspacePath: input.workspacePath,
          ...(input.description ? { description: input.description } : {}),
        })
        .returning();
      ctx.logger.event('workbench.created', { workbenchId: row?.id });
      return row;
    }),

  update: protectedRateLimitedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        description: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch['name'] = input.name;
      if (input.description !== undefined) patch['description'] = input.description;
      const [row] = await ctx.db
        .update(workbenches)
        .set(patch)
        .where(
          and(
            eq(workbenches.id, input.id),
            eq(workbenches.ownerUserId, ctx.user.id),
          ),
        )
        .returning();
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'workbench not found or not owned by user',
        });
      }
      return row;
    }),
});
