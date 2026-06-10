import { desc, eq } from 'drizzle-orm';
import { WorkflowSchema, type Workflow } from '../contracts/index.js';
import type { Db } from '../db/index.js';
import { chats, getDbClient, workbenches, workflows } from '../db/index.js';

/**
 * The platform's default workflow, used when a workbench has no workflow bound
 * yet. Keeps the live run workflow-driven out of the box (every chat follows a
 * real stage sequence) instead of silently dropping to the generic planner.
 */
async function resolveBuiltinWorkflow(db: Db): Promise<Workflow | null> {
  const [row] = await db
    .select({ definition: workflows.definition })
    .from(workflows)
    .where(eq(workflows.builtin, true))
    .orderBy(desc(workflows.updatedAt))
    .limit(1);
  if (!row) return null;
  const parsed = WorkflowSchema.safeParse(row.definition);
  return parsed.success ? parsed.data : null;
}

/**
 * Read the workbench's active workflow definition. Used by the orchestrator
 * to drive a run when no explicit workflow is passed to `runOrchestrator`
 * (spec 100 / #97). Returns null when no workflow is bound — caller falls
 * back to the heuristic / LLM planner.
 *
 * Lives in `src/server/` so the orchestrator (lower layer) can static-import
 * it without pulling in the tRPC router file (which would create a layering
 * cycle).
 */
export async function resolveWorkbenchWorkflow(
  db: Db,
  workbenchId: string,
): Promise<Workflow | null> {
  const [wb] = await db
    .select({ activeWorkflowId: workbenches.activeWorkflowId })
    .from(workbenches)
    .where(eq(workbenches.id, workbenchId));
  if (!wb?.activeWorkflowId) return null;

  const [wfRow] = await db
    .select({ definition: workflows.definition })
    .from(workflows)
    .where(eq(workflows.id, wb.activeWorkflowId));
  if (!wfRow) return null;
  return WorkflowSchema.parse(wfRow.definition);
}

/**
 * Resolve a chat's active workflow by hopping chat → workbench → active
 * workflow. Used by the live turn/dispatch path so a signed-in run follows the
 * workbench's customized workflow stages. Returns null for unknown chats (e.g.
 * the logged-out demo's local chat id) so the caller falls back to the role/LLM
 * planner. Never throws — a resolution failure must not break a turn.
 */
export async function resolveChatWorkflow(
  chatId: string,
): Promise<Workflow | null> {
  try {
    const db = getDbClient().db;
    const [chat] = await db
      .select({ workbenchId: chats.workbenchId })
      .from(chats)
      .where(eq(chats.id, chatId));
    if (!chat?.workbenchId) return null;
    const bound = await resolveWorkbenchWorkflow(db, chat.workbenchId);
    return bound ?? (await resolveBuiltinWorkflow(db));
  } catch {
    return null;
  }
}
