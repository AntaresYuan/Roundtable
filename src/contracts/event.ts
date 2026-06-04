import { z } from 'zod';
import { ArtifactSchema, DepKindSchema } from './artifact.js';

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thinking_delta'), delta: z.string() }),
  z.object({ type: z.literal('text_delta'), delta: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    id: z.string(),
    output: z.unknown(),
    isError: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('file_change'),
    path: z.string(),
    kind: z.enum(['create', 'edit', 'delete']),
    diff: z.string(),
  }),
  z.object({ type: z.literal('artifact'), artifact: ArtifactSchema }),
  z.object({
    type: z.literal('declare_dependency'),
    from: z.string(),
    to: z.string(),
    kind: DepKindSchema,
  }),
  z.object({
    /**
     * PM proposes saving a reusable pattern as a user-scoped skill (spec 100
     * #100, ADR-007 propose/confirm). The UI surfaces this as a "Save as my
     * skill" action; nothing persists until the user confirms.
     */
    type: z.literal('propose_skill'),
    name: z.string().min(1).max(160),
    triggerHint: z.string().min(1).max(500),
    body: z.string().min(1),
    rationale: z.string().optional(),
  }),
  z.object({
    type: z.literal('done'),
    usage: TokenUsageSchema.optional(),
    finishReason: z.string().optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    recoverable: z.boolean(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
