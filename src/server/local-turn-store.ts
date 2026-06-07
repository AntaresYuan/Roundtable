import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  AgentEventSchema,
  ArtifactSchema,
  IntakeResultSchema,
  PlanSchema,
  PlanTaskStatusSchema,
} from '../contracts/index.js';
import { createDbClient, type Db } from '../db/index.js';
import { liveTurns } from '../db/schema.js';

export function localRuntimeRoot(): string {
  return process.env['ROUNDTABLE_LOCAL_ROOT'] ?? join(process.cwd(), '.roundtable');
}

export function localTurnStorePath(): string {
  return process.env['ROUNDTABLE_LOCAL_TURN_STORE'] ?? join(localRuntimeRoot(), 'local-turns.json');
}

const LocalDispatchRecordSchema = z.object({
  taskId: z.string(),
  handoffCardId: z.string(),
  sessionId: z.string(),
  status: PlanTaskStatusSchema,
  events: z.array(AgentEventSchema),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().optional(),
});

export const LocalTurnSchema = z.object({
  id: z.string().min(1),
  localChatId: z.string().optional(),
  message: z.string().min(1),
  status: z.enum(['done', 'error']),
  createdAt: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  pmMessage: z.string().optional(),
  needsApproval: z.boolean().optional(),
  approvalStatus: z.enum(['pending', 'approved', 'changes_requested']).optional(),
  approvedAt: z.string().optional(),
  dispatchStatus: z.enum(['not_started', 'running', 'completed', 'failed']).optional(),
  dispatchAdapter: z.string().optional(),
  dispatchedAt: z.string().optional(),
  dispatch: z.array(LocalDispatchRecordSchema).optional(),
  artifacts: z.array(ArtifactSchema).optional(),
  dispatchStage: z.string().optional(),
  dispatchError: z.string().optional(),
  dispatchWorkspacePath: z.string().optional(),
  intake: IntakeResultSchema.optional(),
  plan: PlanSchema.optional(),
  error: z.string().optional(),
});
export type LocalTurn = z.infer<typeof LocalTurnSchema>;

const LocalTurnListSchema = z.array(LocalTurnSchema);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canUseDbTurnStore(chatId: string | undefined): chatId is string {
  return !!chatId && UUID_RE.test(chatId);
}

export async function listLiveTurns(chatId?: string): Promise<LocalTurn[]> {
  if (canUseDbTurnStore(chatId)) {
    const fromDb = await withDbFallback(
      (db) => listDbTurns(db, chatId),
      'list',
    );
    if (fromDb) return fromDb;
  }
  return listLocalTurns(chatId);
}

export async function saveLiveTurn(turn: LocalTurn): Promise<void> {
  if (canUseDbTurnStore(turn.localChatId)) {
    const saved = await withDbFallback(
      async (db) => {
        await saveDbTurn(db, turn.localChatId!, turn);
        return true;
      },
      'save',
    );
    if (saved) return;
  }
  await saveLocalTurn(turn);
}

export async function getLiveTurn(id: string): Promise<LocalTurn | null> {
  const fromDb = await withDbFallback(
    (db) => getDbTurn(db, id),
    'get',
  );
  if (fromDb) return fromDb;
  return getLocalTurn(id);
}

export async function updateLiveTurn(
  id: string,
  update: (turn: LocalTurn) => LocalTurn,
): Promise<LocalTurn | null> {
  const fromDb = await withDbFallback(
    async (db) => {
      const turn = await getDbTurn(db, id);
      if (!turn) return null;
      const next = update(turn);
      if (!canUseDbTurnStore(next.localChatId)) return null;
      await saveDbTurn(db, next.localChatId, next);
      return next;
    },
    'update',
  );
  if (fromDb) return fromDb;
  return updateLocalTurn(id, update);
}

export async function resolveLiveTurnApproval(
  id: string,
  decision: 'approve' | 'request_changes',
): Promise<LocalTurn | null> {
  return updateLiveTurn(id, approvalUpdate(decision));
}

export async function listLocalTurns(chatId?: string): Promise<LocalTurn[]> {
  try {
    const raw = await readFile(localTurnStorePath(), 'utf8');
    const all = sortLocalTurns(LocalTurnListSchema.parse(JSON.parse(raw)));
    return chatId ? all.filter((t) => t.localChatId === chatId) : all;
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

export async function saveLocalTurn(turn: LocalTurn): Promise<void> {
  const turns = await listLocalTurns();
  const next = [turn, ...turns.filter((item) => item.id !== turn.id)].slice(0, 50);
  await writeLocalTurns(next);
}

export async function getLocalTurn(id: string): Promise<LocalTurn | null> {
  const turns = await listLocalTurns();
  return turns.find((item) => item.id === id) ?? null;
}

export async function updateLocalTurn(
  id: string,
  update: (turn: LocalTurn) => LocalTurn,
): Promise<LocalTurn | null> {
  const turns = await listLocalTurns();
  const turn = turns.find((item) => item.id === id);
  if (!turn) return null;
  const nextTurn = update(turn);
  const next = turns.map((item) => (item.id === id ? nextTurn : item)).slice(0, 50);
  await writeLocalTurns(next);
  return nextTurn;
}

export async function resolveLocalTurnApproval(
  id: string,
  decision: 'approve' | 'request_changes',
): Promise<LocalTurn | null> {
  return updateLocalTurn(id, approvalUpdate(decision));
}

function approvalUpdate(decision: 'approve' | 'request_changes') {
  return (turn: LocalTurn): LocalTurn => {
    const { approvedAt: _approvedAt, ...rest } = turn;
    return {
      ...rest,
      needsApproval: false,
      approvalStatus: decision === 'approve' ? 'approved' : 'changes_requested',
      ...(decision === 'approve' ? { approvedAt: new Date().toISOString() } : {}),
    };
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function writeLocalTurns(turns: LocalTurn[]): Promise<void> {
  const storePath = localTurnStorePath();
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(turns, null, 2)}\n`, 'utf8');
}

function sortLocalTurns(turns: LocalTurn[]): LocalTurn[] {
  return [...turns].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function listDbTurns(db: Db, chatId: string): Promise<LocalTurn[]> {
  const rows = await db
    .select()
    .from(liveTurns)
    .where(eq(liveTurns.chatId, chatId))
    .orderBy(desc(liveTurns.createdAt));
  return rows.map(dbTurnToLocalTurn);
}

export async function getDbTurn(db: Db, id: string): Promise<LocalTurn | null> {
  const [row] = await db.select().from(liveTurns).where(eq(liveTurns.id, id)).limit(1);
  return row ? dbTurnToLocalTurn(row) : null;
}

export async function saveDbTurn(db: Db, chatId: string, turn: LocalTurn): Promise<void> {
  await db
    .insert(liveTurns)
    .values({
      id: turn.id,
      chatId,
      message: turn.message,
      status: turn.status,
      provider: turn.provider ?? null,
      model: turn.model ?? null,
      pmMessage: turn.pmMessage ?? null,
      needsApproval: turn.needsApproval ?? null,
      approvalStatus: turn.approvalStatus ?? null,
      approvedAt: turn.approvedAt ? new Date(turn.approvedAt) : null,
      dispatchStatus: turn.dispatchStatus ?? null,
      dispatchAdapter: turn.dispatchAdapter ?? null,
      dispatchedAt: turn.dispatchedAt ? new Date(turn.dispatchedAt) : null,
      dispatch: turn.dispatch ?? null,
      artifacts: turn.artifacts ?? null,
      dispatchStage: turn.dispatchStage ?? null,
      dispatchError: turn.dispatchError ?? null,
      dispatchWorkspacePath: turn.dispatchWorkspacePath ?? null,
      intake: turn.intake ?? null,
      plan: turn.plan ?? null,
      error: turn.error ?? null,
      createdAt: new Date(turn.createdAt),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: liveTurns.id,
      set: {
        chatId,
        message: turn.message,
        status: turn.status,
        provider: turn.provider ?? null,
        model: turn.model ?? null,
        pmMessage: turn.pmMessage ?? null,
        needsApproval: turn.needsApproval ?? null,
        approvalStatus: turn.approvalStatus ?? null,
        approvedAt: turn.approvedAt ? new Date(turn.approvedAt) : null,
        dispatchStatus: turn.dispatchStatus ?? null,
        dispatchAdapter: turn.dispatchAdapter ?? null,
        dispatchedAt: turn.dispatchedAt ? new Date(turn.dispatchedAt) : null,
        dispatch: turn.dispatch ?? null,
        artifacts: turn.artifacts ?? null,
        dispatchStage: turn.dispatchStage ?? null,
        dispatchError: turn.dispatchError ?? null,
        dispatchWorkspacePath: turn.dispatchWorkspacePath ?? null,
        intake: turn.intake ?? null,
        plan: turn.plan ?? null,
        error: turn.error ?? null,
        updatedAt: new Date(),
      },
    });
}

function dbTurnToLocalTurn(row: typeof liveTurns.$inferSelect): LocalTurn {
  return LocalTurnSchema.parse({
    id: row.id,
    localChatId: row.chatId,
    message: row.message,
    status: row.status,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    pmMessage: row.pmMessage ?? undefined,
    needsApproval: row.needsApproval ?? undefined,
    approvalStatus: row.approvalStatus ?? undefined,
    approvedAt: row.approvedAt?.toISOString(),
    dispatchStatus: row.dispatchStatus ?? undefined,
    dispatchAdapter: row.dispatchAdapter ?? undefined,
    dispatchedAt: row.dispatchedAt?.toISOString(),
    dispatch: row.dispatch ?? undefined,
    artifacts: row.artifacts ?? undefined,
    dispatchStage: row.dispatchStage ?? undefined,
    dispatchError: row.dispatchError ?? undefined,
    dispatchWorkspacePath: row.dispatchWorkspacePath ?? undefined,
    intake: row.intake ?? undefined,
    plan: row.plan ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
  });
}

async function withDbFallback<T>(
  run: (db: Db) => Promise<T>,
  operation: string,
): Promise<T | null> {
  if (process.env['ROUNDTABLE_TURN_STORE'] === 'local') return null;
  const { db, client } = createDbClient();
  try {
    return await run(db);
  } catch (error) {
    if (process.env['ROUNDTABLE_TURN_STORE'] === 'database') throw error;
    if (process.env.NODE_ENV !== 'test') {
      process.stderr.write(`live_turn_store_${operation}_fallback: ${error instanceof Error ? error.message : 'unknown'}\n`);
    }
    return null;
  } finally {
    await client.end();
  }
}
