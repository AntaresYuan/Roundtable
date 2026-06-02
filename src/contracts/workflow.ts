import { z } from 'zod';
import { AgentRoleIdSchema } from './ids.js';
import { HandoffCardSchema } from './handoff.js';

/**
 * Workflow — the ONE editable spec object behind the customizable-workflow feature.
 * See specs/090-workflows.md (§4) and ADR-009 (configure objects, never draw a DAG).
 *
 * NOTE (ownership): contracts are the orchestrator/contracts area (Evanlin). This file
 * was drafted from spec 090 to unblock the UI build (steps 2–3) and is pending the
 * contracts owner's review — reconcile role→adapter defaults with spec 010.
 */

export const AdapterIdSchema = z.enum(['claude-code', 'opencode', 'codex', 'custom']);
export type AdapterId = z.infer<typeof AdapterIdSchema>;

// Role-first ref: built-in templates carry role tokens (castable onto any workbench);
// a workbench-bound workflow resolves them to concrete agentIds.
export const SeatRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }),
  z.object({
    kind: z.literal('role'),
    role: AgentRoleIdSchema,
    agentId: z.string().optional(),
  }),
]);
export type SeatRef = z.infer<typeof SeatRefSchema>;

export const SeatSchema = z.object({
  ref: SeatRefSchema,
  adapter: AdapterIdSchema.optional(), // override; else the role default (spec 010)
  brief: z.string().optional(), // per-seat instruction → HandoffCard.taskBrief
  skills: z.array(z.string()).optional(), // mounted skills/runtime/* ids (spec 070)
  tools: z.array(z.string()).optional(), // MCP tool ids (Custom agents)
});
export type Seat = z.infer<typeof SeatSchema>;

// Discriminated union — replaces the decorative boolean; carries enforcement (§7).
export const GateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('user_approval') }), // pauses; user clicks continue
  z.object({
    kind: z.literal('reviewer_signoff'),
    reviewer: SeatRefSchema,
    blockOn: z.literal('open_comments'),
  }),
]);
export type Gate = z.infer<typeof GateSchema>;

export const StageKindSchema = z.enum(['intake', 'plan', 'work', 'review', 'ship', 'custom']);
export type StageKind = z.infer<typeof StageKindSchema>;

export const StageSchema = z.object({
  id: z.string().min(1), // stable; survives rename/reorder
  name: z.string(),
  icon: z.string(),
  desc: z.string(),
  kind: StageKindSchema, // bridge to the spec-010 loop phase
  seats: z.array(SeatSchema), // replaces who: string[]
  parallelGroup: z.string().optional(), // adjacent stages sharing a groupId fan out
  gate: GateSchema.default({ kind: 'none' }),
  fixed: z.boolean().optional(), // intake only: locked roster/flags
  handoffOverride: HandoffCardSchema.partial().optional(), // user edits to carried context (spec 030)
});
export type Stage = z.infer<typeof StageSchema>;

export const WorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string(), // outcome-named ("Ship a PR-ready feature")
  tag: z.string().optional(), // 'Most used · just works' | 'Yours' | ...
  desc: z.string(),
  origin: z.object({
    kind: z.enum(['builtin', 'user', 'fork']),
    from: z.string().optional(),
  }),
  builtin: z.boolean().optional(), // platform starter (read-only; Fork to edit)
  planning: z.object({
    cut: z.literal('by_role'), // never by_file (spec 010)
    clarifyThreshold: z.number().min(0).max(1), // spec 010 Clarify
    maxClarifyQuestions: z.number().int().nonnegative(),
  }),
  stages: z.array(StageSchema).min(1),
  version: z.number().int().nonnegative(), // bumped on save; drives the diff toast
  updatedAt: z.string(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;
