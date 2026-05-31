import { z } from 'zod';
import { ArtifactIdSchema } from './ids.js';

export const ArtifactKindSchema = z.enum([
  'code',
  'file',
  'diff',
  'web_app',
  'markdown',
  'mermaid',
  'html',
  'spec',
  'doc',
  'preview',
  'note',
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactRefSchema = z.object({
  id: ArtifactIdSchema,
  kind: ArtifactKindSchema,
  title: z.string(),
  uri: z.string().optional(),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const ArtifactSchema = z.object({
  id: ArtifactIdSchema,
  kind: ArtifactKindSchema,
  title: z.string(),
  ownerAgentId: z.string(),
  version: z.number().int().nonnegative(),
  uri: z.string().optional(),
  preview: z.string().optional(),
  createdAt: z.coerce.date(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const DepKindSchema = z.enum(['derives_from', 'replaces', 'references']);
export type DepKind = z.infer<typeof DepKindSchema>;
