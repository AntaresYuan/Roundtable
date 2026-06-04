import { getServerSession } from 'next-auth';
import type { Db } from '../db/index.js';
import { createDbClient } from '../db/index.js';
import { authOptions, type AuthSession, type AuthUser } from './auth.js';
import { createNoopLogger, type Logger } from './logger.js';

export interface CreateTRPCContextOptions {
  session?: AuthSession | null;
  db?: Db;
  logger?: Logger;
}

export interface TRPCContext {
  session: AuthSession | null;
  user: AuthUser | null;
  db: Db;
  logger: Logger;
}

export async function createTRPCContext(
  opts: CreateTRPCContextOptions = {},
): Promise<TRPCContext> {
  const db = opts.db ?? createDbClient().db;
  const session = opts.session ?? null;

  return {
    session,
    user: session?.user ?? null,
    db,
    logger: opts.logger ?? createNoopLogger(),
  };
}

/**
 * Context factory the Next.js `/api/trpc/[trpc]/route.ts` fetch-adapter
 * calls. Reads the NextAuth session via `getServerSession(authOptions)` so
 * `protectedProcedure` works, then defers to `createTRPCContext` for the rest
 * of the wiring (db + logger). Kept thin on purpose — see
 * `docs/phase3-integration.md` for the lane split.
 */
export async function createNextTRPCContext(
  opts: Omit<CreateTRPCContextOptions, 'session'> = {},
): Promise<TRPCContext> {
  const raw = await getServerSession(authOptions);
  const session = (raw ?? null) as AuthSession | null;
  return createTRPCContext({ ...opts, session });
}
