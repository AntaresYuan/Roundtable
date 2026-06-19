import { z } from 'zod';

export const AgentRoleIdSchema = z.enum([
  'architect',
  'planner',
  'implementer',
  'reviewer',
  'fixer',
]);
export type AgentRoleId = z.infer<typeof AgentRoleIdSchema>;

export const AgentIdSchema = z.string().min(1).brand<'AgentId'>();
export type AgentId = z.infer<typeof AgentIdSchema>;

export const SessionIdSchema = z.string().min(1).brand<'SessionId'>();
export type SessionId = z.infer<typeof SessionIdSchema>;

export const ChatIdSchema = z.string().min(1).brand<'ChatId'>();
export type ChatId = z.infer<typeof ChatIdSchema>;

export const MissionIdSchema = z.string().min(1).brand<'MissionId'>();
export type MissionId = z.infer<typeof MissionIdSchema>;

export const ArtifactIdSchema = z.string().min(1).brand<'ArtifactId'>();
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
