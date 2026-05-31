import type { Db } from '../db/index.js';
import { createDbClient } from '../db/index.js';
import type { AuthSession, AuthUser } from './auth.js';
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
