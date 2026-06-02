import { z } from 'zod';
import { GateSchema } from './workflow.js';

/**
 * WorkflowRun — read-only OBSERVED runtime state for a running workflow. The user never
 * edits this; it is the truth the WorkflowStrip and GateCard render. Kept separate from
 * the editable `Workflow` spec (ADR-009). See specs/090-workflows.md (§4, §7).
 *
 * NOTE (ownership): contracts area (Evanlin); drafted from spec 090 — pending review.
 */

export const ReviewCommentSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  line: z.number().int().nonnegative().optional(),
  body: z.string(),
  author: z.string(), // agentId
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export const StageStatusSchema = z.enum(['pending', 'active', 'blocked', 'done', 'failed']);
export type StageStatus = z.infer<typeof StageStatusSchema>;

export const StageRunStateSchema = z.object({
  status: StageStatusSchema,
  seatRuns: z.array(
    z.object({
      agentId: z.string(),
      status: z.string(),
      artifactIds: z.array(z.string()),
    }),
  ),
  gate: z
    .object({
      open: z.boolean(),
      reason: z.string().optional(),
      comments: z.array(ReviewCommentSchema).optional(),
    })
    .optional(),
});
export type StageRunState = z.infer<typeof StageRunStateSchema>;

export const WorkflowRunSchema = z.object({
  specId: z.string(),
  specVersion: z.number().int().nonnegative(),
  stageStates: z.record(z.string(), StageRunStateSchema), // keyed by stageId
  activeStageId: z.string().optional(),
  pendingGate: z.object({ stageId: z.string(), gate: GateSchema }).optional(),
  depEdges: z.array(
    z.object({ from: z.string(), to: z.string(), stale: z.boolean() }),
  ), // emergent, agent-declared (spec 060)
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

// The event the UI emits to clear a blocked gate and let the run advance (§7).
export const GateResolveEventSchema = z.object({
  type: z.literal('gate.resolve'),
  stageId: z.string(),
  decision: z.enum(['approve', 'request_changes']),
});
export type GateResolveEvent = z.infer<typeof GateResolveEventSchema>;
