import { missionFromWorkflowRun, type Mission } from '../contracts/index.js';
import { listLiveTurns, type LocalTurn } from './local-turn-store.js';

/**
 * Mission read path (spec 110 §7 step 2 / #147). Projects the live
 * `workflow + workflowRun + plan` carried on a turn into a `Mission` so the UI
 * can render a single Mission timeline without a database migration or a change
 * to the live dispatch path. This is the compatibility bridge: Mission is the
 * read object, `WorkflowRun` stays the runtime source of truth.
 */

/**
 * Pick the turn that represents the chat's current Mission. Turns arrive
 * newest-first from the store, so the first one that actually drove a workflow
 * run is the live Mission; older turns are superseded executions.
 */
export function latestMissionTurn(turns: LocalTurn[]): LocalTurn | undefined {
  return turns.find((turn) => turn.workflow && turn.workflowRun);
}

/** Project a single turn into a Mission, or null when it never ran a workflow. */
export function missionFromTurn(
  turn: LocalTurn,
  chatId?: string,
): Mission | null {
  if (!turn.workflow || !turn.workflowRun) return null;
  return missionFromWorkflowRun({
    id: `mission-${turn.id}`,
    goal: turn.message,
    ...(chatId ? { chatId } : {}),
    workflow: turn.workflow,
    workflowRun: turn.workflowRun,
    ...(turn.plan ? { plan: turn.plan } : {}),
    createdAt: turn.createdAt,
  });
}

/**
 * Load the active Mission for a chat from live turn history. Returns null when
 * the chat has no workflow-driven turn yet (e.g. a fresh chat or a planning
 * failure), which the UI renders as "no mission started".
 */
export async function loadMissionForChat(
  chatId?: string,
): Promise<Mission | null> {
  const turns = await listLiveTurns(chatId);
  const turn = latestMissionTurn(turns);
  if (!turn) return null;
  return missionFromTurn(turn, chatId);
}
