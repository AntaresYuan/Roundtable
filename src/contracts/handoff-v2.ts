import { z } from 'zod';
import { MissionIdSchema } from './ids.js';
import { ArtifactRefSchema, type ArtifactRef } from './artifact.js';
import {
  AgentRoleSnapshotSchema,
  HandoffCardSchema,
  HandoffContextAuditSchema,
  HandoffScenarioSchema,
  PinnedMessageSchema,
  type HandoffCard,
} from './handoff.js';

/**
 * HandoffCard V2 (spec 120 / #149). Upgrades the readable HandoffCard (spec 030)
 * into a structured collaboration object with two layers:
 *
 * - **human layer** — what the user reads (intent, brief, summary, questions);
 *   keeps the current readable card experience via `handoffCardV2ToLegacy`.
 * - **protocol layer** — the minimum-sufficient machine context a downstream
 *   agent consumes (task references, pinned constraints, artifact *refs*),
 *   surfaced by `toHandoffV2ProtocolPayload`.
 *
 * A2A is the design inspiration only: `task` + `contextId` mirror A2A's Task and
 * contextId, `referenceTaskIds` lets a card point at prior tasks, and
 * `HandoffTaskState` tracks A2A-style task lifecycle. We do not aim for protocol
 * compliance. Token discipline is preserved: artifacts are always referenced,
 * never inlined, and raw history is never carried — only `fullHistoryRef`.
 */

/** Bump on a breaking change to the V2 wire format. */
export const HANDOFF_CARD_V2_VERSION = 2;

/** A2A `TaskState`-inspired lifecycle of a referenced task. */
export const HandoffTaskStateSchema = z.enum([
  'submitted',
  'working',
  'input_required',
  'completed',
  'failed',
  'canceled',
]);
export type HandoffTaskState = z.infer<typeof HandoffTaskStateSchema>;

/** A2A `Task` + `contextId`-inspired reference to a task within a mission. */
export const HandoffTaskRefSchema = z.object({
  taskId: z.string().min(1),
  contextId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  state: HandoffTaskStateSchema.optional(),
});
export type HandoffTaskRef = z.infer<typeof HandoffTaskRefSchema>;

/** Human layer — the readable card the user inspects and can edit. */
export const HandoffHumanLayerSchema = z.object({
  userIntent: z.string(),
  taskBrief: z.string(),
  summary: z.string().optional(),
  openQuestions: z.array(z.string()).default([]),
  rolesInGroup: z.array(AgentRoleSnapshotSchema).default([]),
});
export type HandoffHumanLayer = z.infer<typeof HandoffHumanLayerSchema>;

/** Protocol layer — minimum-sufficient context for the downstream agent. */
export const HandoffContextPackageSchema = z.object({
  pinnedMessages: z.array(PinnedMessageSchema).max(10).default([]),
  taskReferences: z.array(HandoffTaskRefSchema).default([]),
  artifactRefs: z.array(ArtifactRefSchema).default([]),
  audit: HandoffContextAuditSchema.optional(),
  fullHistoryRef: z.string(),
});
export type HandoffContextPackage = z.infer<typeof HandoffContextPackageSchema>;

export const HandoffNextActionSchema = z.object({
  instruction: z.string(),
  acceptanceCriteria: z.array(z.string()).default([]),
});
export type HandoffNextAction = z.infer<typeof HandoffNextActionSchema>;

export const HandoffRiskSchema = z.object({
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string(),
});
export type HandoffRisk = z.infer<typeof HandoffRiskSchema>;

export const HandoffProvenanceSchema = z.object({
  generatedBy: z.enum(['orchestrator', 'agent', 'user']),
  sourceAgentId: z.string().optional(),
  sourceAgentRole: z.string().optional(),
  // An AgentCard snapshot lands here in #152; the slot keeps provenance
  // forward-compatible without a schema break.
});
export type HandoffProvenance = z.infer<typeof HandoffProvenanceSchema>;

export const HandoffCardV2Schema = z.object({
  protocolVersion: z.literal(HANDOFF_CARD_V2_VERSION),
  cardId: z.string().min(1),
  missionId: MissionIdSchema.optional(),
  scenario: HandoffScenarioSchema,
  fromAgent: z.string().min(1),
  toAgent: z.string().min(1),
  sourceTaskId: z.string().min(1).optional(),
  referenceTaskIds: z.array(z.string().min(1)).default([]),
  task: HandoffTaskRefSchema,
  human: HandoffHumanLayerSchema,
  contextPackage: HandoffContextPackageSchema,
  artifacts: z.array(ArtifactRefSchema).default([]),
  nextAction: HandoffNextActionSchema,
  risks: z.array(HandoffRiskSchema).default([]),
  provenance: HandoffProvenanceSchema,
  createdAt: z.coerce.date(),
});
export type HandoffCardV2 = z.infer<typeof HandoffCardV2Schema>;

function dedupeArtifacts(refs: ArtifactRef[]): ArtifactRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
}

/**
 * Down-convert a V2 card into the legacy HandoffCard so the existing UI renders
 * it without losing the readable card experience (acceptance #149). Lossy by
 * design: the protocol-only fields collapse into the legacy shape.
 */
export function handoffCardV2ToLegacy(card: HandoffCardV2): HandoffCard {
  const relevantArtifacts = dedupeArtifacts([
    ...card.artifacts,
    ...card.contextPackage.artifactRefs,
  ]);
  return HandoffCardSchema.parse({
    id: card.cardId,
    from: card.fromAgent,
    to: card.toAgent,
    scenario: card.scenario,
    userIntent: card.human.userIntent,
    taskBrief: card.human.taskBrief,
    pinnedMessages: card.contextPackage.pinnedMessages,
    rolesInGroup: card.human.rolesInGroup,
    ...(card.human.summary
      ? {
          previousAgent: {
            summary: card.human.summary,
            keyOutputs: card.artifacts,
            openQuestions: card.human.openQuestions,
          },
        }
      : {}),
    relevantArtifacts,
    ...(card.contextPackage.audit ? { contextAudit: card.contextPackage.audit } : {}),
    fullHistoryRef: card.contextPackage.fullHistoryRef,
    createdAt: card.createdAt,
    generatedBy: 'orchestrator',
  });
}

/**
 * Upgrade an existing legacy HandoffCard record into a V2 card so older logs and
 * stored cards flow through the V2 surface. Best-effort: legacy cards have no
 * explicit task id, so the card id stands in as the task reference.
 */
export function handoffCardToV2(
  card: HandoffCard,
  opts: { missionId?: string; sourceTaskId?: string } = {},
): HandoffCardV2 {
  return HandoffCardV2Schema.parse({
    protocolVersion: HANDOFF_CARD_V2_VERSION,
    cardId: card.id,
    ...(opts.missionId ? { missionId: opts.missionId } : {}),
    scenario: card.scenario,
    fromAgent: card.from,
    toAgent: card.to,
    ...(opts.sourceTaskId ? { sourceTaskId: opts.sourceTaskId } : {}),
    referenceTaskIds: [],
    task: { taskId: card.id, ...(card.taskBrief ? { title: card.taskBrief } : {}) },
    human: {
      userIntent: card.userIntent,
      taskBrief: card.taskBrief,
      ...(card.previousAgent?.summary ? { summary: card.previousAgent.summary } : {}),
      openQuestions: card.previousAgent?.openQuestions ?? [],
      rolesInGroup: card.rolesInGroup,
    },
    contextPackage: {
      pinnedMessages: card.pinnedMessages,
      taskReferences: [],
      artifactRefs: card.relevantArtifacts,
      ...(card.contextAudit ? { audit: card.contextAudit } : {}),
      fullHistoryRef: card.fullHistoryRef,
    },
    artifacts: card.previousAgent?.keyOutputs ?? [],
    nextAction: { instruction: card.taskBrief, acceptanceCriteria: [] },
    risks: [],
    provenance: { generatedBy: 'orchestrator' },
    createdAt: card.createdAt,
  });
}

/**
 * Extract the protocol layer for injection into a downstream agent's input
 * context. Carries references only — pinned constraints as text, artifacts and
 * tasks as ids — never raw history or artifact bodies (token discipline, #149).
 */
export function toHandoffV2ProtocolPayload(card: HandoffCardV2) {
  return {
    protocolVersion: card.protocolVersion,
    cardId: card.cardId,
    ...(card.missionId ? { missionId: card.missionId } : {}),
    task: card.task,
    ...(card.sourceTaskId ? { sourceTaskId: card.sourceTaskId } : {}),
    referenceTaskIds: card.referenceTaskIds,
    taskReferences: card.contextPackage.taskReferences,
    instruction: card.nextAction.instruction,
    acceptanceCriteria: card.nextAction.acceptanceCriteria,
    pinnedConstraints: card.contextPackage.pinnedMessages.map((p) => p.content),
    artifactRefs: dedupeArtifacts([
      ...card.artifacts,
      ...card.contextPackage.artifactRefs,
    ]).map((a) => ({ id: a.id, kind: a.kind, title: a.title })),
    risks: card.risks,
    fullHistoryRef: card.contextPackage.fullHistoryRef,
  };
}
