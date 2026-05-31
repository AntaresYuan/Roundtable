import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { chats } from '../db/index.js';
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
