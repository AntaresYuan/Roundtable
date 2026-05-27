import { z } from 'zod';
import { AgentRoleIdSchema, SessionIdSchema } from './ids.js';

export const McpServerConfigSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const SessionBudgetSchema = z.object({
  maxTokens: z.number().int().positive().optional(),
  maxRuntimeMs: z.number().int().positive().optional(),
});
export type SessionBudget = z.infer<typeof SessionBudgetSchema>;

export const SessionOptsSchema = z.object({
  sessionId: SessionIdSchema.optional(),
  cwd: z.string().min(1),
  systemPrompt: z.string().optional(),
  mcpServers: z.array(McpServerConfigSchema).optional(),
  allowedTools: z.array(z.string()).optional(),
  role: AgentRoleIdSchema,
  agentMeta: z.object({
    displayName: z.string(),
    color: z.string(),
  }),
  budget: SessionBudgetSchema.optional(),
});
export type SessionOpts = z.infer<typeof SessionOptsSchema>;

export const UserInputSchema = z.object({
  text: z.string(),
  attachments: z
    .array(
      z.object({
        kind: z.enum(['file', 'image', 'artifact_ref']),
        uri: z.string(),
      }),
    )
    .optional(),
});
export type UserInput = z.infer<typeof UserInputSchema>;

export const AgentCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  toolUse: z.boolean(),
  fileEdits: z.boolean(),
  persistentSessions: z.boolean(),
  mcp: z.boolean(),
  multimodal: z.boolean(),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;
