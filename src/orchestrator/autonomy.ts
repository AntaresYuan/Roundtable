import { randomUUID } from 'node:crypto';
import type {
  AutonomyAction,
  AutonomyDecision,
  AutonomyPolicy,
  AutonomyRisk,
  Gate,
  Stage,
} from '../contracts/index.js';

const RISK_ORDER: Record<AutonomyRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function evaluateAutonomyAction(input: {
  policy: AutonomyPolicy;
  action: AutonomyAction;
  risk: AutonomyRisk;
  reason: string;
}): AutonomyDecision {
  const { policy, action, risk, reason } = input;
  const decision =
    risk === 'high' || policy.blockedActions.includes(action)
      ? 'requires_user'
      : policy.allowedAutoActions.includes(action) &&
          RISK_ORDER[risk] <= RISK_ORDER[policy.autoApproveUpToRisk]
        ? 'auto_approved'
        : 'requires_user';

  return {
    id: randomUUID(),
    action,
    risk,
    policyLevel: policy.level,
    decision,
    reason,
    createdAt: new Date(),
  };
}

export function evaluateRetry(input: {
  policy: AutonomyPolicy;
  usedRetries: number;
  risk: AutonomyRisk;
  reason: string;
}): AutonomyDecision {
  if (input.usedRetries >= input.policy.retryBudget) {
    return {
      id: randomUUID(),
      action: 'retry_agent',
      risk: input.risk,
      policyLevel: input.policy.level,
      decision: 'requires_user',
      reason: `${input.reason} Retry budget exhausted.`,
      createdAt: new Date(),
    };
  }

  return evaluateAutonomyAction({
    policy: input.policy,
    action: 'retry_agent',
    risk: input.risk,
    reason: input.reason,
  });
}

export function riskForGate(stage: Stage, gate: Gate): AutonomyRisk {
  if (stage.kind === 'ship') return 'high';
  if (gate.kind === 'user_approval') return 'high';
  if (gate.kind === 'reviewer_signoff') return 'low';
  return 'low';
}
