import { randomUUID } from 'node:crypto';
import type {
  AgentRoleSnapshot,
  ArtifactId,
  ArtifactRef,
  HandoffCard,
  PinnedMessage,
} from '../contracts/index.js';
import type { DepChangedNotice } from './dependency-graph.js';

/** Pre-formatted chat string for a single notice. Matches spec 060's template. */
export function buildDepChangedMessage(notice: DepChangedNotice): string {
  const upstreamLabel = notice.upstream.title ?? notice.upstream.artifactId;
  const downstreamLabel = notice.downstream.title ?? notice.downstream.artifactId;
  const versionDelta = `v${notice.upstream.fromVersion}→v${notice.upstream.toVersion}`;
  const hopHint = notice.downstream.hopsFromChange === 1 ? '' : ` (hop ${notice.downstream.hopsFromChange})`;
  return `⚠️ @${notice.downstream.ownerAgentId} \`${upstreamLabel}\` changed ${versionDelta} — your \`${downstreamLabel}\` may need a sync${hopHint}`;
}

export interface BuildSyncHandoffOptions {
  notice: DepChangedNotice;
  /**
   * One-line summary of the upstream change (e.g. extracted from the diff).
   * Becomes `previousAgent.summary` on the HandoffCard.
   */
  changeSummary: string;
  /** `from` field on the card. Defaults to "orchestrator". */
  fromAgentId?: string;
  /** Free-text user intent. Defaults to "Sync downstream artifact after upstream change". */
  userIntent?: string;
  /** Cross-link to the full conversation (chat URL or persisted message id). */
  fullHistoryRef: string;
  /** Pinned messages to carry over (cap of 10 enforced by the contract). */
  pinnedMessages?: PinnedMessage[];
  /** Snapshot of agent roles in the room. */
  rolesInGroup?: AgentRoleSnapshot[];
  /** Optional artifact references beyond upstream + downstream. */
  extraArtifacts?: ArtifactRef[];
  /** Optional open questions to pass to the downstream agent. */
  openQuestions?: string[];
  /** Override the generated id / clock for tests. */
  id?: string;
  now?: () => Date;
}

/**
 * Build a `HandoffCard` for "Ask @<owner> to sync" — wires the upstream
 * artifact change into `previousAgent.summary` so the downstream agent
 * picks up exactly the context needed for a re-sync (spec 060 AC).
 */
export function buildSyncHandoffCard(opts: BuildSyncHandoffOptions): HandoffCard {
  const now = (opts.now ?? (() => new Date()))();
  const upstreamRef: ArtifactRef = {
    id: opts.notice.upstream.artifactId,
    kind: 'file',
    title: opts.notice.upstream.title ?? String(opts.notice.upstream.artifactId),
  };
  const downstreamRef: ArtifactRef = {
    id: opts.notice.downstream.artifactId,
    kind: 'file',
    title: opts.notice.downstream.title ?? String(opts.notice.downstream.artifactId),
  };
  const relevantArtifacts: ArtifactRef[] = [
    upstreamRef,
    downstreamRef,
    ...(opts.extraArtifacts ?? []),
  ];

  return {
    id: opts.id ?? randomUUID(),
    from: opts.fromAgentId ?? 'orchestrator',
    to: opts.notice.downstream.ownerAgentId,
    scenario: 'agent_handoff',
    userIntent:
      opts.userIntent ?? 'Sync downstream artifact after upstream change.',
    taskBrief: buildTaskBrief(opts.notice, opts.changeSummary),
    pinnedMessages: (opts.pinnedMessages ?? []).slice(0, 10),
    rolesInGroup: opts.rolesInGroup ?? [],
    previousAgent: {
      summary: opts.changeSummary,
      keyOutputs: [upstreamRef],
      openQuestions: opts.openQuestions ?? [],
    },
    relevantArtifacts,
    fullHistoryRef: opts.fullHistoryRef,
    createdAt: now,
    generatedBy: 'orchestrator',
  };
}

function buildTaskBrief(notice: DepChangedNotice, changeSummary: string): string {
  const upstreamLabel = notice.upstream.title ?? notice.upstream.artifactId;
  const downstreamLabel = notice.downstream.title ?? notice.downstream.artifactId;
  return [
    `Upstream \`${upstreamLabel}\` (owned by @${notice.upstream.ownerAgentId}) bumped to v${notice.upstream.toVersion}.`,
    `Change summary: ${changeSummary}`,
    `Please review \`${downstreamLabel}\` and reconcile any references that no longer hold.`,
  ].join(' ');
}

/** Convenience: also stamp an `ArtifactId` cast for callers without ids module. */
export type { ArtifactId };
