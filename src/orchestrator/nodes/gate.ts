import { interrupt } from '@langchain/langgraph';
import type { GateDecision, OrchestratorState, PendingGate } from '../state.js';

/**
 * Gate pause node. When `state.pendingGate` is set, the graph stops here and
 * `interrupt()`s the LangGraph runtime — exactly like clarify's `await_user`.
 *
 * Resume payload: `{ stageId: string; decision: 'approve' | 'request_changes' }`.
 * On resume we record the decision in `state.gateDecisions`, clear pendingGate,
 * and route to aggregate (approve) or aggregate with the decision recorded
 * (request_changes — the next-step UX lives in #75 / GateCard).
 */
export function runGatePause(state: OrchestratorState): OrchestratorState {
  if (!state.pendingGate) {
    return { ...state, stage: 'aggregate' };
  }

  const payload = interrupt({
    kind: 'gate',
    stageId: state.pendingGate.stageId,
    gate: state.pendingGate.gate,
  }) as { stageId?: string; decision?: GateDecision } | undefined;

  if (!payload || !payload.stageId || !payload.decision) {
    return state;
  }

  return applyGateDecision(state, state.pendingGate, payload.stageId, payload.decision);
}

function applyGateDecision(
  state: OrchestratorState,
  pending: PendingGate,
  stageId: string,
  decision: GateDecision,
): OrchestratorState {
  if (stageId !== pending.stageId) {
    return state;
  }
  const gateDecisions: Record<string, GateDecision> = {
    ...state.gateDecisions,
    [stageId]: decision,
  };
  return {
    ...state,
    gateDecisions,
    pendingGate: undefined,
    stage: 'aggregate',
  };
}
