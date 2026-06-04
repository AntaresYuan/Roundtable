import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  AgentEventSchema,
  ArtifactSchema,
  IntakeResultSchema,
  PlanSchema,
  PlanTaskStatusSchema,
} from '../contracts/index.js';

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

export async function listLocalTurns(): Promise<LocalTurn[]> {
  try {
    const raw = await readFile(localTurnStorePath(), 'utf8');
    return sortLocalTurns(LocalTurnListSchema.parse(JSON.parse(raw)));
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
  return updateLocalTurn(id, (turn) => {
    const { approvedAt: _approvedAt, ...rest } = turn;
    return {
      ...rest,
      needsApproval: false,
      approvalStatus: decision === 'approve' ? 'approved' : 'changes_requested',
      ...(decision === 'approve' ? { approvedAt: new Date().toISOString() } : {}),
    };
  });
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
