import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { IntakeResultSchema, PlanSchema } from '../contracts/index.js';

const STORE_PATH = join(process.cwd(), '.roundtable', 'local-turns.json');

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
  intake: IntakeResultSchema.optional(),
  plan: PlanSchema.optional(),
  error: z.string().optional(),
});
export type LocalTurn = z.infer<typeof LocalTurnSchema>;

const LocalTurnListSchema = z.array(LocalTurnSchema);

export async function listLocalTurns(): Promise<LocalTurn[]> {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    return LocalTurnListSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

export async function saveLocalTurn(turn: LocalTurn): Promise<void> {
  const turns = await listLocalTurns();
  const next = [turn, ...turns.filter((item) => item.id !== turn.id)].slice(0, 50);
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export async function resolveLocalTurnApproval(
  id: string,
  decision: 'approve' | 'request_changes',
): Promise<LocalTurn | null> {
  const turns = await listLocalTurns();
  const turn = turns.find((item) => item.id === id);
  if (!turn) return null;

  const nextTurn: LocalTurn = {
    ...turn,
    needsApproval: false,
    approvalStatus: decision === 'approve' ? 'approved' : 'changes_requested',
    approvedAt: new Date().toISOString(),
  };
  const next = [nextTurn, ...turns.filter((item) => item.id !== id)].slice(0, 50);
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return nextTurn;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
