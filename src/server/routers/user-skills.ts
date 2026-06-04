import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { userSkills } from '../../db/index.js';
import {
  createTRPCRouter,
  protectedProcedure,
  protectedRateLimitedProcedure,
} from '../trpc.js';

/**
 * User-scoped skill library (spec 100 L5 / #100). The PM proposes; the user
 * explicitly saves. No auto-recall, no opaque RAG — mounted into HandoffCards
 * via deterministic `trigger_hint` keyword matching (ADR-010).
 */
export const userSkillsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(userSkills)
      .where(eq(userSkills.ownerUserId, ctx.user.id))
      .orderBy(desc(userSkills.updatedAt)),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(userSkills)
        .where(
          and(eq(userSkills.id, input.id), eq(userSkills.ownerUserId, ctx.user.id)),
        );
      return row ?? null;
    }),

  /** Persist a proposed skill after the user confirms (UI "Save as my skill"). */
  create: protectedRateLimitedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(160),
        triggerHint: z.string().min(1).max(500),
        body: z.string().min(1),
        sourceChatId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(userSkills)
        .values({
          id: randomUUID(),
          ownerUserId: ctx.user.id,
          name: input.name,
          triggerHint: input.triggerHint,
          body: input.body,
          ...(input.sourceChatId ? { sourceChatId: input.sourceChatId } : {}),
        })
        .returning();
      ctx.logger.event('user_skill.created', { skillId: row?.id });
      return row;
    }),

  update: protectedRateLimitedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        triggerHint: z.string().min(1).max(500).optional(),
        body: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch['name'] = input.name;
      if (input.triggerHint !== undefined) patch['triggerHint'] = input.triggerHint;
      if (input.body !== undefined) patch['body'] = input.body;
      const [row] = await ctx.db
        .update(userSkills)
        .set(patch)
        .where(
          and(eq(userSkills.id, input.id), eq(userSkills.ownerUserId, ctx.user.id)),
        )
        .returning();
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Skill not found or not owned by user',
        });
      }
      return row;
    }),

  delete: protectedRateLimitedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(userSkills)
        .where(
          and(eq(userSkills.id, input.id), eq(userSkills.ownerUserId, ctx.user.id)),
        )
        .returning();
      ctx.logger.event('user_skill.deleted', { skillId: input.id });
      return { count: deleted.length };
    }),
});
