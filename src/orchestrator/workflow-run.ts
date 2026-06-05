import type {
  StageRunState,
  StageStatus,
  Workflow,
  WorkflowRun,
} from '../contracts/index.js';
import type { DispatchRecord, OrchestratorState } from './state.js';

/**
 * Project the orchestrator's mutable state onto the read-only `WorkflowRun`
 * shape the UI/tRPC subscribes to (specs/090-workflows.md §4). Pure function —
 * the WorkflowStrip and GateCard render from this alone, no clock-magic.
 */
export function workflowRunFromState(state: OrchestratorState): WorkflowRun | undefined {
  if (!state.workflow) return undefined;
  const workflow = state.workflow;

  const stageStates: Record<string, StageRunState> = {};
  for (const stage of workflow.stages) {
    stageStates[stage.id] = buildStageState(stage.id, workflow, state);
  }

  const activeStageId = pickActiveStageId(workflow, stageStates);

  return {
    specId: workflow.id,
    specVersion: workflow.version,
    autonomyPolicy: state.autonomyPolicy,
    autonomyDecisions: state.autonomyDecisions,
    stageStates,
    ...(activeStageId ? { activeStageId } : {}),
    ...(state.pendingGate
      ? { pendingGate: { stageId: state.pendingGate.stageId, gate: state.pendingGate.gate } }
      : {}),
    ...(state.pendingRecovery ? { pendingRecovery: state.pendingRecovery } : {}),
    failureRecoveryCards: state.failureRecoveryCards,
    depEdges: [],
  };
}

function buildStageState(
  stageId: string,
  workflow: Workflow,
  state: OrchestratorState,
): StageRunState {
  const stage = workflow.stages.find((s) => s.id === stageId)!;
  const taskIds = state.plan?.tasks
    .filter((t) => t.workflowStageId === stageId)
    .map((t) => t.id) ?? [];
  const records = state.dispatch.filter((r) => taskIds.includes(r.taskId));

  const seatRuns = stage.seats.map((seat, idx) => {
    const taskId = `${stageId}__${idx}`;
    const record = records.find((r) => r.taskId === taskId);
    const agentId = seat.ref.kind === 'role' ? seat.ref.agentId ?? seat.ref.role : 'user';
    return {
      agentId,
      status: record?.status ?? 'pending',
      artifactIds: record
        ? record.events
            .filter((e) => e.type === 'artifact')
            .map((e) => (e as { artifact: { id: string } }).artifact.id)
        : [],
    };
  });

  const status: StageStatus = computeStageStatus(state, stage.id, records);
  const gateDecision = state.gateDecisions[stage.id];
  const gateState =
    stage.gate.kind !== 'none'
      ? {
          open: status === 'blocked',
          ...(gateDecision ? { reason: gateDecision } : {}),
        }
      : undefined;

  return {
    status,
    seatRuns,
    ...(gateState ? { gate: gateState } : {}),
  };
}

function computeStageStatus(
  state: OrchestratorState,
  stageId: string,
  records: DispatchRecord[],
): StageStatus {
  if (state.pendingGate?.stageId === stageId) return 'blocked';
  const recoveryTaskId = state.pendingRecovery?.taskId;
  if (recoveryTaskId && records.some((r) => r.taskId === recoveryTaskId)) {
    return 'blocked';
  }
  if (records.length === 0) return 'pending';
  if (records.some((r) => r.status === 'failed')) return 'failed';
  if (records.every((r) => r.status === 'completed')) return 'done';
  return 'active';
}

function pickActiveStageId(
  workflow: Workflow,
  stageStates: Record<string, StageRunState>,
): string | undefined {
  const blocked = workflow.stages.find((s) => stageStates[s.id]?.status === 'blocked');
  if (blocked) return blocked.id;
  const active = workflow.stages.find((s) => stageStates[s.id]?.status === 'active');
  if (active) return active.id;
  const firstPending = workflow.stages.find(
    (s) => stageStates[s.id]?.status === 'pending',
  );
  return firstPending?.id;
}
