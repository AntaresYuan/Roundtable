import { eq } from 'drizzle-orm';
import { WorkflowSchema, type Workflow } from '../contracts/index.js';
import type { Db } from '../db/index.js';
import { workbenches, workflows } from '../db/index.js';

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
