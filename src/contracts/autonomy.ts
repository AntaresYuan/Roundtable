import { z } from 'zod';

export const AutonomyLevelSchema = z.enum([
  'ask_every_time',
  'auto_fix_safe',
  'run_until_blocked',
]);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

export const AutonomyRiskSchema = z.enum(['low', 'medium', 'high']);
export type AutonomyRisk = z.infer<typeof AutonomyRiskSchema>;

export const AutonomyActionSchema = z.enum([
  'approve_gate',
  'retry_agent',
  'reassign_agent',
  'edit_handoff',
  'apply_review_fix',
  'deploy',
  'change_secrets',
  'change_auth',
  'delete_large_scope',
  'expand_tool_access',
]);
export type AutonomyAction = z.infer<typeof AutonomyActionSchema>;

export const AutonomyPolicySchema = z.object({
  level: AutonomyLevelSchema,
  label: z.string(),
  retryBudget: z.number().int().nonnegative(),
  runtimeBudgetMs: z.number().int().positive().optional(),
  tokenBudget: z.number().int().positive().optional(),
  allowedAutoActions: z.array(AutonomyActionSchema),
  blockedActions: z.array(AutonomyActionSchema),
  autoApproveUpToRisk: AutonomyRiskSchema,
});
export type AutonomyPolicy = z.infer<typeof AutonomyPolicySchema>;

export const AutonomyDecisionSchema = z.object({
  id: z.string(),
  action: AutonomyActionSchema,
  risk: AutonomyRiskSchema,
  policyLevel: AutonomyLevelSchema,
  decision: z.enum(['auto_approved', 'blocked', 'requires_user']),
  reason: z.string(),
  createdAt: z.coerce.date(),
});
export type AutonomyDecision = z.infer<typeof AutonomyDecisionSchema>;

const SAFE_AUTO_ACTIONS: AutonomyAction[] = [
  'approve_gate',
  'retry_agent',
  'apply_review_fix',
];
const BLOCKED_HIGH_RISK_ACTIONS: AutonomyAction[] = [
  'deploy',
  'change_secrets',
  'change_auth',
  'delete_large_scope',
  'expand_tool_access',
];

export const AUTONOMY_POLICY_PRESETS: Record<AutonomyLevel, AutonomyPolicy> = {
  ask_every_time: {
    level: 'ask_every_time',
    label: 'Ask every time',
    retryBudget: 0,
    allowedAutoActions: [],
    blockedActions: BLOCKED_HIGH_RISK_ACTIONS,
    autoApproveUpToRisk: 'low',
  },
  auto_fix_safe: {
    level: 'auto_fix_safe',
    label: 'Auto-fix safe issues',
    retryBudget: 1,
    allowedAutoActions: SAFE_AUTO_ACTIONS,
    blockedActions: BLOCKED_HIGH_RISK_ACTIONS,
    autoApproveUpToRisk: 'low',
  },
  run_until_blocked: {
    level: 'run_until_blocked',
    label: 'Run until blocked',
    retryBudget: 2,
    allowedAutoActions: SAFE_AUTO_ACTIONS,
    blockedActions: BLOCKED_HIGH_RISK_ACTIONS,
    autoApproveUpToRisk: 'medium',
  },
};

export const DEFAULT_AUTONOMY_POLICY =
  AUTONOMY_POLICY_PRESETS.ask_every_time;
