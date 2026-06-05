import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { userProfiles } from '../../db/index.js';
import { createTRPCRouter, protectedProcedure, protectedRateLimitedProcedure } from '../trpc.js';

const userProfileUpdateInput = z.object({
  defaultBrief: z.string().max(4000).optional(),
  defaultSkills: z.array(z.string().min(1).max(120)).max(50).optional(),
  notes: z.string().max(4000).optional(),
});

export const userProfileRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const [profile] = await ctx.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, ctx.user.id));
    return (
      profile ?? {
        userId: ctx.user.id,
        defaultBrief: '',
        defaultSkills: [],
        notes: '',
        updatedAt: null,
      }
    );
  }),

  update: protectedRateLimitedProcedure
    .input(userProfileUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, ctx.user.id));
      const patch = {
        userId: ctx.user.id,
        defaultBrief: input.defaultBrief ?? existing?.defaultBrief ?? '',
        defaultSkills: input.defaultSkills ?? existing?.defaultSkills ?? [],
        notes: input.notes ?? existing?.notes ?? '',
        updatedAt: new Date(),
      };

      const [profile] = await ctx.db
        .insert(userProfiles)
        .values(patch)
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: {
            defaultBrief: patch.defaultBrief,
            defaultSkills: patch.defaultSkills,
            notes: patch.notes,
            updatedAt: patch.updatedAt,
          },
        })
        .returning();

      ctx.logger.event('user_profile.updated', { userId: ctx.user.id });
      return profile;
    }),
});
