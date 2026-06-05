import { z } from 'zod';
import { AutonomyDecisionSchema } from './autonomy.js';

export const FailureRecoveryActionSchema = z.enum([
  'retry',
  'reassign',
  'edit_handoff',
  'stop',
]);
export type FailureRecoveryAction = z.infer<typeof FailureRecoveryActionSchema>;

export const FailureRecoveryCardSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  taskTitle: z.string(),
  agentId: z.string(),
  summary: z.string(),
  debugDetails: z.string().optional(),
  attemptsUsed: z.number().int().positive(),
  retryBudget: z.number().int().nonnegative(),
  actions: z.array(FailureRecoveryActionSchema),
  autonomyDecision: AutonomyDecisionSchema.optional(),
  createdAt: z.coerce.date(),
});
export type FailureRecoveryCard = z.infer<typeof FailureRecoveryCardSchema>;
