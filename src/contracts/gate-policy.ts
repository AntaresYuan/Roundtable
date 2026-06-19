import type { Gate } from './workflow.js';
import type {
  MissionCheckpointKind,
  MissionDecisionAction,
  MissionTask,
} from './mission.js';

/**
 * Quality-gate policy (spec 140 / #150). Maps each workflow `Gate` kind to the
 * Mission checkpoint it produces, the user actions it allows, and a plain-language
 * explanation of what the user must do. This is what turns agent execution into a
 * controllable product: the orchestrator must not advance past a gate until an
 * advancing decision is recorded, and a blocked Mission can say exactly what input
 * it needs.
 *
 * Pure data + helpers — no orchestrator/LangGraph imports — so the contract,
 * server read API, and UI all share one source of truth.
 */

export type GateKind = Gate['kind'];
export type EnforcedGateKind = Exclude<GateKind, 'none'>;

interface GatePolicyEntry {
  checkpointKind: MissionCheckpointKind;
  actions: readonly MissionDecisionAction[];
  explain: string;
}

/** Decisions that let a Mission advance past the gate. */
export const GATE_ADVANCE_ACTIONS: readonly MissionDecisionAction[] = [
  'approve',
  'accept_delivery',
];

export const GATE_POLICY: Record<EnforcedGateKind, GatePolicyEntry> = {
  user_approval: {
    checkpointKind: 'user_approval',
    actions: ['approve', 'request_changes', 'reject', 'pause', 'resume'],
    explain: 'Review and approve before work continues.',
  },
  clarification: {
    checkpointKind: 'clarification',
    actions: ['approve', 'request_changes', 'reject'],
    explain: 'Answer a clarifying question so the team can proceed.',
  },
  plan_approval: {
    checkpointKind: 'plan_approval',
    actions: ['approve', 'request_changes', 'reject', 'reassign'],
    explain: 'Approve the plan, or ask for smaller tasks or changes.',
  },
  api_contract_approval: {
    checkpointKind: 'user_approval',
    actions: ['approve', 'request_changes', 'reject'],
    explain: 'Approve the proposed API contract before implementation.',
  },
  handoff_acceptance: {
    checkpointKind: 'handoff_acceptance',
    actions: ['approve', 'reject', 'reassign'],
    explain: 'Accept or reject the handoff from the previous agent.',
  },
  test_repair: {
    checkpointKind: 'test_repair',
    actions: ['request_tests', 'approve', 'reassign'],
    explain: 'Tests failed — request a repair or more tests before continuing.',
  },
  reviewer_signoff: {
    checkpointKind: 'reviewer_signoff',
    actions: ['approve', 'request_changes', 'reject'],
    explain: 'A reviewer must sign off before delivery.',
  },
  final_acceptance: {
    checkpointKind: 'final_acceptance',
    actions: ['accept_delivery', 'request_changes', 'reject'],
    explain: 'Accept the final delivery, or send it back for changes.',
  },
};

/** Does this gate require human intervention before the stage can advance? */
export function gateNeedsUser(gate: Gate): boolean {
  return gate.kind !== 'none';
}

/** The Mission checkpoint kind a gate maps to (undefined for `none`). */
export function checkpointKindForGate(
  gate: Gate,
): MissionCheckpointKind | undefined {
  return gate.kind === 'none' ? undefined : GATE_POLICY[gate.kind].checkpointKind;
}

/** The user actions allowed at this gate. */
export function allowedGateActions(gate: Gate): readonly MissionDecisionAction[] {
  return gate.kind === 'none' ? [] : GATE_POLICY[gate.kind].actions;
}

export function isGateActionAllowed(
  gate: Gate,
  action: MissionDecisionAction,
): boolean {
  return allowedGateActions(gate).includes(action);
}

/** Plain-language explanation of what the user must do (gate.prompt wins). */
export function explainGate(gate: Gate): string | undefined {
  if (gate.kind === 'none') return undefined;
  if ('prompt' in gate && gate.prompt) return gate.prompt;
  return GATE_POLICY[gate.kind].explain;
}

export function isAdvanceAction(action: MissionDecisionAction): boolean {
  return GATE_ADVANCE_ACTIONS.includes(action);
}

/**
 * Whether a gate may be passed given the decisions recorded against it. A gate
 * blocks until at least one advancing decision (`approve` / `accept_delivery`)
 * is present — this is the enforcement the orchestrator consults before
 * dispatching the next stage.
 */
export function canAdvancePastGate(
  decisions: readonly MissionDecisionAction[],
): boolean {
  return decisions.some(isAdvanceAction);
}

/**
 * Build a follow-up task for a rejected or failed handoff. Returns a NEW pending
 * task that depends on the original; the original (often already `completed`) is
 * never mutated, so the audit trail of what each task produced stays intact (#150,
 * #153).
 */
export function followUpTaskForRejection(
  task: MissionTask,
  opts: { reason?: string; idSuffix?: string } = {},
): MissionTask {
  return {
    ...task,
    id: `${task.id}__rework${opts.idSuffix ? `-${opts.idSuffix}` : ''}`,
    title: `Rework: ${task.title}`,
    status: 'pending',
    dependsOnTaskIds: Array.from(new Set([...task.dependsOnTaskIds, task.id])),
    artifactIds: [],
    handoffCardIds: [],
  };
}
