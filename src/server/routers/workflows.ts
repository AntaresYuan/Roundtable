import { randomUUID } from 'node:crypto';
import { desc, eq, or } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { WorkflowSchema } from '../../contracts/index.js';
import type { Workflow } from '../../contracts/index.js';
import { workbenches, workflows } from '../../db/index.js';
import { assertWorkbenchAccess } from '../access.js';
import {
  createTRPCRouter,
  protectedProcedure,
  protectedRateLimitedProcedure,
} from '../trpc.js';

const WorkflowDefinitionInput = WorkflowSchema.partial({ id: true, updatedAt: true });

/**
 * Workflow persistence at workbench scope (spec 100 / #97). Replaces the
 * localStorage v1 in `rt.js`. Built-ins live as rows with `builtin = true` +
 * `origin = 'builtin'` and are seeded by migration 0003.
 */
export const workflowsRouter = createTRPCRouter({
  /** Built-ins + this user's saved workflows. UI gallery feeds from here. */
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(workflows)
      .where(
        or(eq(workflows.builtin, true), eq(workflows.ownerUserId, ctx.user.id)),
      )
      .orderBy(desc(workflows.builtin), desc(workflows.updatedAt)),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.id));
      if (!row) return null;
      // Built-ins are world-readable; user/fork workflows must be owned.
      if (!row.builtin && row.ownerUserId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return row;
    }),

  create: protectedRateLimitedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(160),
        description: z.string().max(2000).optional(),
        definition: WorkflowDefinitionInput,
        workbenchId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.workbenchId) {
        await assertWorkbenchAccess(ctx, input.workbenchId);
      }
      const id = randomUUID();
      const definition: Workflow = WorkflowSchema.parse({
        ...input.definition,
        id,
        updatedAt: new Date().toISOString(),
        origin: input.definition.origin ?? { kind: 'user' },
        version: input.definition.version ?? 1,
      });
      const [row] = await ctx.db
        .insert(workflows)
        .values({
          id,
          ownerUserId: ctx.user.id,
          ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
          name: input.name,
          ...(input.description ? { description: input.description } : {}),
          definition,
          origin: 'user',
          version: definition.version,
        })
        .returning();
      ctx.logger.event('workflow.created', { workflowId: row?.id });
      return row;
    }),

  update: protectedRateLimitedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        description: z.string().max(2000).optional(),
        definition: WorkflowDefinitionInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.id));
      if (!existing || existing.builtin || existing.ownerUserId !== ctx.user.id) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Workflow not found or not editable',
        });
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch['name'] = input.name;
      if (input.description !== undefined) patch['description'] = input.description;
      if (input.definition !== undefined) {
        const merged: Workflow = WorkflowSchema.parse({
          ...(existing.definition as Workflow),
          ...input.definition,
          id: existing.id,
          updatedAt: new Date().toISOString(),
          version: (input.definition.version ?? (existing.definition as Workflow).version) + 1,
        });
        patch['definition'] = merged;
        patch['version'] = merged.version;
      }
      const [row] = await ctx.db
        .update(workflows)
        .set(patch)
        .where(eq(workflows.id, input.id))
        .returning();
      return row;
    }),

  /** Fork any visible workflow (built-in or another of your own) into a user-owned copy. */
  fork: protectedRateLimitedProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        workbenchId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [source] = await ctx.db
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.sourceId));
      if (!source || (!source.builtin && source.ownerUserId !== ctx.user.id)) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (input.workbenchId) {
        await assertWorkbenchAccess(ctx, input.workbenchId);
      }
      const id = randomUUID();
      const baseDef = source.definition as Workflow;
      const definition: Workflow = WorkflowSchema.parse({
        ...baseDef,
        id,
        version: 1,
        updatedAt: new Date().toISOString(),
        origin: { kind: 'fork', from: source.id },
      });
      const [row] = await ctx.db
        .insert(workflows)
        .values({
          id,
          ownerUserId: ctx.user.id,
          ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
          name: input.name ?? `${source.name} (fork)`,
          definition,
          origin: 'fork',
          fromWorkflowId: source.id,
          version: 1,
        })
        .returning();
      return row;
    }),

  /** Bind a workflow to a workbench (sets `workbenches.active_workflow_id`). */
  bindToWorkbench: protectedRateLimitedProcedure
    .input(
      z.object({
        workflowId: z.string().uuid(),
        workbenchId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkbenchAccess(ctx, input.workbenchId);
      const [wf] = await ctx.db
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.workflowId));
      if (!wf || (!wf.builtin && wf.ownerUserId !== ctx.user.id)) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await ctx.db
        .update(workbenches)
        .set({ activeWorkflowId: input.workflowId, updatedAt: new Date() })
        .where(eq(workbenches.id, input.workbenchId));
      return { ok: true as const };
    }),
});

// resolveWorkbenchWorkflow moved to src/server/workflows-query.ts to avoid
// a server→orchestrator layering cycle. Re-exported for backwards compat.
export { resolveWorkbenchWorkflow } from '../workflows-query.js';
