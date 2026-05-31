import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AgentCapabilitiesSchema, AgentRoleIdSchema } from '../../contracts/index.js';
import { customAgents } from '../../db/index.js';
import { createTRPCRouter, protectedProcedure, protectedRateLimitedProcedure } from '../trpc.js';

export const agentsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(customAgents)
      .where(eq(customAgents.ownerUserId, ctx.user.id)),
  ),

  create: protectedRateLimitedProcedure
    .input(
      z.object({
        displayName: z.string().min(1).max(80),
        role: AgentRoleIdSchema.optional(),
        avatar: z.string().optional(),
        systemPrompt: z.string().min(1),
        capabilities: AgentCapabilitiesSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [agent] = await ctx.db
        .insert(customAgents)
        .values({
          id: randomUUID(),
          ownerUserId: ctx.user.id,
          displayName: input.displayName,
          role: input.role,
          avatar: input.avatar,
          systemPrompt: input.systemPrompt,
          capabilities: input.capabilities,
        })
        .returning();

      ctx.logger.event('agent.created', { agentId: agent?.id });
      return agent;
    }),
});
