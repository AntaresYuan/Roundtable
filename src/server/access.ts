import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { chats, workbenches } from '../db/index.js';
import type { AuthUser } from './auth.js';
import type { TRPCContext } from './context.js';

export interface AuthorizedContext extends TRPCContext {
  user: AuthUser;
}

export async function assertChatAccess(
  ctx: AuthorizedContext,
  chatId: string,
): Promise<void> {
  const [chat] = await ctx.db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ctx.user.id)));

  if (!chat) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
  }
}

export async function assertWorkbenchAccess(
  ctx: AuthorizedContext,
  workbenchId: string,
): Promise<void> {
  const [row] = await ctx.db
    .select({ id: workbenches.id })
    .from(workbenches)
    .where(
      and(eq(workbenches.id, workbenchId), eq(workbenches.ownerUserId, ctx.user.id)),
    );

  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workbench not found' });
  }
}

export async function chatWorkbenchId(
  ctx: AuthorizedContext,
  chatId: string,
): Promise<string> {
  const [chat] = await ctx.db
    .select({ workbenchId: chats.workbenchId })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ctx.user.id)));

  if (!chat) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
  }
  return chat.workbenchId;
}
