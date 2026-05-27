import { z } from 'zod';

export const PlanTaskStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
]);
export type PlanTaskStatus = z.infer<typeof PlanTaskStatusSchema>;

export const PlanTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  assignee: z.string().regex(/^@/, 'assignee must start with @'),
  deps: z.array(z.string()),
  parallel: z.boolean().optional(),
  user_visible: z.boolean().default(true),
  status: PlanTaskStatusSchema.default('pending'),
});
export type PlanTask = z.infer<typeof PlanTaskSchema>;

export const PlanSchema = z.object({
  id: z.string().min(1),
  createdAt: z.coerce.date(),
  tasks: z.array(PlanTaskSchema).min(1),
});
export type Plan = z.infer<typeof PlanSchema>;
