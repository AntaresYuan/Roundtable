import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';

const DEFAULT_DATABASE_URL =
  'postgres://roundtable:roundtable@localhost:5432/roundtable';

export interface PostgresCheckpointerOptions {
  /** Postgres connection string. Defaults to `DATABASE_URL` env, then the dev compose URL. */
  connectionString?: string;
  /** Reuse an existing pool instead of creating one. Caller owns lifecycle when provided. */
  pool?: pg.Pool;
  /** Custom Postgres schema for the checkpoint tables. Defaults to `public`. */
  schema?: string;
  /** Skip `saver.setup()` on construction. Defaults to false (i.e. setup runs). */
  skipSetup?: boolean;
}

export interface PostgresCheckpointerHandle {
  readonly saver: PostgresSaver;
  readonly pool: pg.Pool;
  /** Closes the pool only if it was created by this factory. */
  readonly close: () => Promise<void>;
}

/**
 * Build a Postgres-backed LangGraph checkpointer. Replaces the W1 `MemorySaver`
 * placeholder so orchestrator runs survive process restarts (ADR-001).
 *
 * `setup()` is idempotent — safe to call on every boot.
 */
export async function createPostgresCheckpointer(
  opts: PostgresCheckpointerOptions = {},
): Promise<PostgresCheckpointerHandle> {
  const ownsPool = !opts.pool;
  const pool =
    opts.pool ??
    new pg.Pool({
      connectionString:
        opts.connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    });
  const saver = new PostgresSaver(
    pool,
    undefined,
    opts.schema ? { schema: opts.schema } : undefined,
  );
  if (!opts.skipSetup) {
    await saver.setup();
  }
  return {
    saver,
    pool,
    close: async () => {
      if (ownsPool) await pool.end();
    },
  };
}

export interface CleanupOldCheckpointsOptions {
  saver: PostgresSaver;
  pool: pg.Pool;
  /** Default 30. Threads whose owning chat hasn't been touched in this many days are purged. */
  olderThanDays?: number;
  /** Postgres schema where checkpoint tables live. Defaults to `public`. */
  schema?: string;
}

export interface CleanupResult {
  deletedThreads: string[];
}

/**
 * Garbage-collect checkpoint rows for stale or orphaned chats.
 *
 * A thread is considered stale when either (a) no matching `chats` row exists
 * (orphan), or (b) `chats.updated_at` is older than `olderThanDays`. We use
 * `chats.updated_at` as the freshness signal because we use `chatId` as the
 * LangGraph `thread_id` (see `runOrchestrator`).
 *
 * Deletion goes through `PostgresSaver.deleteThread()` so writes, blobs, and
 * channel state are removed together.
 */
export async function cleanupOldCheckpoints(
  opts: CleanupOldCheckpointsOptions,
): Promise<CleanupResult> {
  const days = opts.olderThanDays ?? 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const schema = opts.schema ?? 'public';

  const { rows } = await opts.pool.query<{ thread_id: string }>(
    `SELECT DISTINCT c.thread_id
       FROM "${schema}".checkpoints c
       LEFT JOIN public.chats ch ON ch.id::text = c.thread_id
      WHERE ch.id IS NULL OR ch.updated_at < $1`,
    [cutoff],
  );

  const deletedThreads: string[] = [];
  for (const { thread_id } of rows) {
    await opts.saver.deleteThread(thread_id);
    deletedThreads.push(thread_id);
  }
  return { deletedThreads };
}

export { PostgresSaver };
