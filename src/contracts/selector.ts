import { z } from 'zod';
import { AgentIdSchema, AgentRoleIdSchema, ChatIdSchema } from './ids.js';

/** What the selector knows about each agent in the room. */
export const AgentDescriptionSchema = z.object({
  id: AgentIdSchema,
  displayName: z.string().min(1),
  role: AgentRoleIdSchema,
  /** Free-form description: "frontend specialist", "writes API endpoints"… */
  description: z.string().default(''),
  /** Optional keyword tags the selector can hint on (e.g. ["react","css"]). */
  capabilities: z.array(z.string()).default([]),
});
export type AgentDescription = z.infer<typeof AgentDescriptionSchema>;

/** A ranked runner-up considered by the selector. */
export const SelectorRunnerUpSchema = z.object({
  agentId: AgentIdSchema,
  confidence: z.number().min(0).max(1),
});
export type SelectorRunnerUp = z.infer<typeof SelectorRunnerUpSchema>;

/** Output of one selector invocation. */
export const SelectorDecisionSchema = z.object({
  /** `null` when no agent fits — the orchestrator should plan instead. */
  chosenAgentId: AgentIdSchema.nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  runnersUp: z.array(SelectorRunnerUpSchema).default([]),
});
export type SelectorDecision = z.infer<typeof SelectorDecisionSchema>;

/** Persisted telemetry row for later analysis (spec 050 § (a) guard). */
export const SelectorDecisionEntrySchema = z.object({
  ts: z.string(),
  chatId: ChatIdSchema,
  userMessage: z.string(),
  agentCount: z.number().int().nonnegative(),
  decision: SelectorDecisionSchema,
  fallbackTriggered: z.boolean(),
});
export type SelectorDecisionEntry = z.infer<typeof SelectorDecisionEntrySchema>;
