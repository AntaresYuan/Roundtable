import { z } from 'zod';
import { AgentRoleIdSchema } from './ids.js';

export const IntakeResultSchema = z.object({
  intentType: z.enum(['build', 'modify', 'inspect', 'debug', 'review', 'control']),
  clarity: z.enum(['clear', 'ambiguous']),
  ambiguityScore: z.number().min(0).max(1),
  complexity: z.enum(['single_agent', 'multi_agent']),
  risk: z.enum(['low', 'medium', 'high']),
  suggestedRoles: z.array(AgentRoleIdSchema),
  userVisibleSummary: z.string(),
});
export type IntakeResult = z.infer<typeof IntakeResultSchema>;
