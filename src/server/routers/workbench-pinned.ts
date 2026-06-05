import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { messages, pinnedMessages, workbenchPinnedMessages } from '../../db/index.js';
import { assertChatAccess, assertWorkbenchAccess, chatWorkbenchId } from '../access.js';
import {
  createTRPCRouter,
  protectedProcedure,
  protectedRateLimitedProcedure,
} from '../trpc.js';

/** Same cap as chat-level pins (spec 030 § Token control). */
export const WORKBENCH_PIN_CAP = 10;

/**
 * Workbench-level (project) pinned constraints — spec 100 / #98. Free-form
 * `content` text (unlike chat pins which reference a `messages` row) because
 * project rules outlive any single chat.
 */
export const workbenchPinnedRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ workbenchId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkbenchAccess(ctx, input.workbenchId);
      return ctx.db
        .select()
        .from(workbenchPinnedMessages)
        .where(eq(workbenchPinnedMessages.workbenchId, input.workbenchId))
        .orderBy(asc(workbenchPinnedMessages.position));
    }),

  pin: protectedRateLimitedProcedure
    .input(
      z.object({
        workbenchId: z.string().uuid(),
        content: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkbenchAccess(ctx, input.workbenchId);
      return ctx.db.transaction(async (tx) => {
        const existing = await tx
          .select({
            id: workbenchPinnedMessages.id,
            content: workbenchPinnedMessages.content,
            position: workbenchPinnedMessages.position,
            createdAt: workbenchPinnedMessages.createdAt,
          })
          .from(workbenchPinnedMessages)
          .where(eq(workbenchPinnedMessages.workbenchId, input.workbenchId))
          .orderBy(asc(workbenchPinnedMessages.position));

        const alreadyPinned = existing.find((r) => r.content === input.content);
        if (alreadyPinned) {
          return {
            ok: true as const,
            pin: { ...alreadyPinned, workbenchId: input.workbenchId },
          };
        }

        if (existing.length >= WORKBENCH_PIN_CAP) {
          return {
            ok: false as const,
            error: 'cap_exceeded' as const,
            cap: WORKBENCH_PIN_CAP,
            current: existing,
          };
        }

        const used = new Set(existing.map((r) => r.position));
        let position = 0;
        while (used.has(position) && position < WORKBENCH_PIN_CAP) position += 1;

        const [inserted] = await tx
          .insert(workbenchPinnedMessages)
          .values({
            id: randomUUID(),
            workbenchId: input.workbenchId,
            content: input.content,
            pinnedByUserId: ctx.user.id,
            position,
          })
          .returning();

        ctx.logger.event('workbench.pinned', {
          workbenchId: input.workbenchId,
          position,
        });
        return { ok: true as const, pin: inserted };
      });
    }),

  unpin: protectedRateLimitedProcedure
    .input(z.object({ workbenchId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkbenchAccess(ctx, input.workbenchId);
      const deleted = await ctx.db
        .delete(workbenchPinnedMessages)
        .where(
          and(
            eq(workbenchPinnedMessages.workbenchId, input.workbenchId),
            eq(workbenchPinnedMessages.id, input.id),
          ),
        )
        .returning();
      ctx.logger.event('workbench.unpinned', {
        workbenchId: input.workbenchId,
        id: input.id,
      });
      return { count: deleted.length };
    }),

  replacePin: protectedRateLimitedProcedure
    .input(
      z.object({
        workbenchId: z.string().uuid(),
        content: z.string().min(1).max(2000),
        evictId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkbenchAccess(ctx, input.workbenchId);
      return ctx.db.transaction(async (tx) => {
        const [alreadyPinned] = await tx
          .select({
            id: workbenchPinnedMessages.id,
            content: workbenchPinnedMessages.content,
            position: workbenchPinnedMessages.position,
            createdAt: workbenchPinnedMessages.createdAt,
          })
          .from(workbenchPinnedMessages)
          .where(
            and(
              eq(workbenchPinnedMessages.workbenchId, input.workbenchId),
              eq(workbenchPinnedMessages.content, input.content),
            ),
          );
        if (alreadyPinned) {
          return {
            ok: true as const,
            pin: { ...alreadyPinned, workbenchId: input.workbenchId },
          };
        }

        const evicted = await tx
          .delete(workbenchPinnedMessages)
          .where(
            and(
              eq(workbenchPinnedMessages.workbenchId, input.workbenchId),
              eq(workbenchPinnedMessages.id, input.evictId),
            ),
          )
          .returning({
            id: workbenchPinnedMessages.id,
            position: workbenchPinnedMessages.position,
          });
        if (evicted.length === 0) {
          return { ok: false as const, error: 'evict_not_found' as const };
        }
        const freedPosition = evicted[0]!.position;

        const [inserted] = await tx
          .insert(workbenchPinnedMessages)
          .values({
            id: randomUUID(),
            workbenchId: input.workbenchId,
            content: input.content,
            pinnedByUserId: ctx.user.id,
            position: freedPosition,
          })
          .returning();
        return { ok: true as const, pin: inserted };
      });
    }),

  /**
   * Explicit promotion (spec 100 §6): copy a chat-level pin's content into
   * the workbench scope. The chat pin is preserved — promotion is additive.
   */
  promoteFromChat: protectedRateLimitedProcedure
    .input(
      z.object({
        workbenchId: z.string().uuid(),
        chatPinId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkbenchAccess(ctx, input.workbenchId);
      const [row] = await ctx.db
        .select({
          chatId: pinnedMessages.chatId,
          messageId: pinnedMessages.messageId,
          content: messages.content,
        })
        .from(pinnedMessages)
        .innerJoin(
          messages,
          and(
            eq(messages.id, pinnedMessages.messageId),
            eq(messages.chatId, pinnedMessages.chatId),
          ),
        )
        .where(eq(pinnedMessages.id, input.chatPinId));
      if (!row) {
        return { ok: false as const, error: 'chat_pin_not_found' as const };
      }
      await assertChatAccess(ctx, row.chatId);
      const wbId = await chatWorkbenchId(ctx, row.chatId);
      if (wbId !== input.workbenchId) {
        return { ok: false as const, error: 'workbench_mismatch' as const };
      }

      return ctx.db.transaction(async (tx) => {
        const existing = await tx
          .select({
            id: workbenchPinnedMessages.id,
            content: workbenchPinnedMessages.content,
            position: workbenchPinnedMessages.position,
            createdAt: workbenchPinnedMessages.createdAt,
          })
          .from(workbenchPinnedMessages)
          .where(eq(workbenchPinnedMessages.workbenchId, input.workbenchId))
          .orderBy(asc(workbenchPinnedMessages.position));
        const alreadyPinned = existing.find((r) => r.content === row.content);
        if (alreadyPinned) {
          return {
            ok: true as const,
            pin: { ...alreadyPinned, workbenchId: input.workbenchId },
          };
        }

        if (existing.length >= WORKBENCH_PIN_CAP) {
          return {
            ok: false as const,
            error: 'cap_exceeded' as const,
            cap: WORKBENCH_PIN_CAP,
          };
        }
        const used = new Set(existing.map((r) => r.position));
        let position = 0;
        while (used.has(position) && position < WORKBENCH_PIN_CAP) position += 1;

        const [inserted] = await tx
          .insert(workbenchPinnedMessages)
          .values({
            id: randomUUID(),
            workbenchId: input.workbenchId,
            content: row.content,
            pinnedByUserId: ctx.user.id,
            position,
          })
          .returning();
        return { ok: true as const, pin: inserted };
      });
    }),
});
