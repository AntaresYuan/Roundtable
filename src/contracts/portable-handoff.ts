import { z } from 'zod';
import { ArtifactIdSchema, ChatIdSchema } from './ids.js';
import { ArtifactKindSchema } from './artifact.js';
import { HandoffCardSchema } from './handoff.js';

/** Bump on a breaking change to the portable JSON wire format. */
export const PORTABLE_HANDOFF_VERSION = 1;

/**
 * Self-contained artifact snapshot for export. Spec 030 § Token-control § 3
 * says artifacts are usually *referenced*; cross-chat export is the
 * deliberate exception — chat B has no access to chat A's `artifacts` table,
 * so we inline content / preview / uri.
 */
export const InlinedArtifactSchema = z.object({
  id: ArtifactIdSchema,
  kind: ArtifactKindSchema,
  title: z.string(),
  uri: z.string().optional(),
  preview: z.string().optional(),
  content: z.string().optional(),
  ownerAgentId: z.string(),
  version: z.number().int().nonnegative(),
});
export type InlinedArtifact = z.infer<typeof InlinedArtifactSchema>;

/**
 * Portable, self-contained HandoffCard for cross-chat transfer.
 *
 * Shape: a regular HandoffCard (with `scenario: 'cross_chat'`) plus inlined
 * artifact bodies and provenance metadata. Designed to be exported as JSON
 * from chat A and imported into chat B.
 */
export const PortableHandoffCardSchema = z.object({
  format: z.literal('roundtable.portable_handoff'),
  version: z.literal(PORTABLE_HANDOFF_VERSION),
  sourceChatId: ChatIdSchema,
  exportedAt: z.coerce.date(),
  card: HandoffCardSchema,
  inlinedArtifacts: z.array(InlinedArtifactSchema),
});
export type PortableHandoffCard = z.infer<typeof PortableHandoffCardSchema>;
