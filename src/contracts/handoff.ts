import { z } from 'zod';
import { AgentRoleIdSchema } from './ids.js';
import { ArtifactRefSchema } from './artifact.js';

export const PinnedMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  pinnedBy: z.string(),
});
export type PinnedMessage = z.infer<typeof PinnedMessageSchema>;

export const AgentRoleSnapshotSchema = z.object({
  agentId: z.string(),
  role: AgentRoleIdSchema,
  displayName: z.string(),
  color: z.string(),
});
export type AgentRoleSnapshot = z.infer<typeof AgentRoleSnapshotSchema>;

export const HandoffScenarioSchema = z.enum([
  'dispatch',
  'agent_handoff',
  'join_group',
  'cross_chat',
]);
export type HandoffScenario = z.infer<typeof HandoffScenarioSchema>;

export const HandoffCardSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  scenario: HandoffScenarioSchema,

  userIntent: z.string(),
  taskBrief: z.string(),

  pinnedMessages: z.array(PinnedMessageSchema).max(10),
  rolesInGroup: z.array(AgentRoleSnapshotSchema),

  previousAgent: z
    .object({
      summary: z.string(),
      keyOutputs: z.array(ArtifactRefSchema),
      openQuestions: z.array(z.string()),
    })
    .optional(),

  relevantArtifacts: z.array(ArtifactRefSchema),

  fullHistoryRef: z.string(),

  createdAt: z.coerce.date(),
  generatedBy: z.literal('orchestrator'),
});
export type HandoffCard = z.infer<typeof HandoffCardSchema>;
