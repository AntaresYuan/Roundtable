import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_POLICY_PRESETS,
  AutonomyPolicySchema,
} from '../../src/contracts/autonomy.js';
import { evaluateAutonomyAction, evaluateRetry } from '../../src/orchestrator/autonomy.js';

describe('AutonomyPolicy', () => {
  it('ships user-facing presets with budgets and action boundaries', () => {
    expect(AutonomyPolicySchema.parse(AUTONOMY_POLICY_PRESETS.ask_every_time).label)
      .toBe('Ask every time');
    expect(AUTONOMY_POLICY_PRESETS.auto_fix_safe.retryBudget).toBe(1);
    expect(AUTONOMY_POLICY_PRESETS.run_until_blocked.autoApproveUpToRisk).toBe('medium');
  });

  it('auto-approves only allowed safe actions within the policy risk threshold', () => {
    const decision = evaluateAutonomyAction({
      policy: AUTONOMY_POLICY_PRESETS.auto_fix_safe,
      action: 'approve_gate',
      risk: 'low',
      reason: 'review gate completed',
    });

    expect(decision).toMatchObject({
      action: 'approve_gate',
      decision: 'auto_approved',
      policyLevel: 'auto_fix_safe',
    });
  });

  it('never auto-approves high-risk actions', () => {
    const decision = evaluateAutonomyAction({
      policy: AUTONOMY_POLICY_PRESETS.run_until_blocked,
      action: 'deploy',
      risk: 'high',
      reason: 'production deploy',
    });

    expect(decision.decision).toBe('requires_user');
  });

  it('escalates retries when the policy budget is exhausted', () => {
    const firstRetry = evaluateRetry({
      policy: AUTONOMY_POLICY_PRESETS.auto_fix_safe,
      usedRetries: 0,
      risk: 'low',
      reason: 'adapter failed',
    });
    const exhaustedRetry = evaluateRetry({
      policy: AUTONOMY_POLICY_PRESETS.auto_fix_safe,
      usedRetries: 1,
      risk: 'low',
      reason: 'adapter failed again',
    });

    expect(firstRetry.decision).toBe('auto_approved');
    expect(exhaustedRetry).toMatchObject({
      action: 'retry_agent',
      decision: 'requires_user',
    });
  });
});
