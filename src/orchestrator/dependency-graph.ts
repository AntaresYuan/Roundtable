import type {
  AgentEvent,
  Artifact,
  ArtifactId,
  DepKind,
} from '../contracts/index.js';

/** Maximum hops surfaced as a downstream notice. Spec 060 § Cost control. */
export const MAX_NOTICE_HOPS = 2;

export interface ArtifactNode {
  artifactId: ArtifactId;
  version: number;
  ownerAgentId: string;
  title?: string;
  lastBumpedAt: Date;
}

export interface DependencyEdge {
  from: ArtifactId;
  to: ArtifactId;
  kind: DepKind;
}

/**
 * Notice emitted when an upstream artifact bumps version and downstream
 * consumers exist. The orchestrator's broadcast layer turns each notice into
 * a chat message + "Ask @<owner> to sync" button (see `dependency-broadcast`).
 */
export interface DepChangedNotice {
  upstream: {
    artifactId: ArtifactId;
    title?: string;
    ownerAgentId: string;
    fromVersion: number;
    toVersion: number;
  };
  downstream: {
    artifactId: ArtifactId;
    title?: string;
    ownerAgentId: string;
    hopsFromChange: number;
  };
  kind: DepKind;
}

export interface RecordArtifactResult {
  isNew: boolean;
  isNewVersion: boolean;
  previousVersion?: number;
}

/**
 * In-memory graph of artifact dependencies. Backs spec 060's "dependency
 * changed" badge. Reducer-style: `applyEvent` consumes the orchestrator's
 * canonical `AgentEvent` stream and returns any notices to broadcast.
 *
 * Reverse-edge index keeps downstream lookup O(neighbors), so the
 * spec 060 < 1s SLA after an upstream bump is trivial.
 */
export class DependencyGraph {
  private readonly nodes = new Map<ArtifactId, ArtifactNode>();
  /** from → set of { to, kind } */
  private readonly outgoing = new Map<ArtifactId, Map<ArtifactId, Set<DepKind>>>();
  /** to → set of { from, kind } (reverse index for downstream queries) */
  private readonly incoming = new Map<ArtifactId, Map<ArtifactId, Set<DepKind>>>();

  // ── mutations ─────────────────────────────────────────────────────────────

  /** Add a directed edge `from → to`. No-op if the same triple already exists. */
  addDependency(from: ArtifactId, to: ArtifactId, kind: DepKind): boolean {
    if (from === to) return false; // matches the DB CHECK constraint.
    if (!getOrCreate(this.outgoing, from).get(to)?.has(kind)) {
      addToNested(this.outgoing, from, to, kind);
      addToNested(this.incoming, to, from, kind);
      return true;
    }
    return false;
  }

  /**
   * Record an artifact observation. Returns whether the artifact is new and
   * whether this is a *new* version bump (i.e. seen before with lower version).
   */
  recordArtifact(artifact: Artifact, at: Date = new Date()): RecordArtifactResult {
    const id = artifact.id;
    const existing = this.nodes.get(id);
    if (!existing) {
      this.nodes.set(id, {
        artifactId: id,
        version: artifact.version,
        ownerAgentId: artifact.ownerAgentId,
        ...(artifact.title !== undefined ? { title: artifact.title } : {}),
        lastBumpedAt: at,
      });
      return { isNew: true, isNewVersion: false };
    }
    if (artifact.version > existing.version) {
      const previousVersion = existing.version;
      this.nodes.set(id, {
        ...existing,
        version: artifact.version,
        ownerAgentId: artifact.ownerAgentId,
        ...(artifact.title !== undefined ? { title: artifact.title } : {}),
        lastBumpedAt: at,
      });
      return { isNew: false, isNewVersion: true, previousVersion };
    }
    return { isNew: false, isNewVersion: false };
  }

  // ── queries ───────────────────────────────────────────────────────────────

  hasNode(id: ArtifactId): boolean {
    return this.nodes.has(id);
  }

  getNode(id: ArtifactId): ArtifactNode | undefined {
    return this.nodes.get(id);
  }

  /** All outgoing edges of `id` (artifacts that `id` depends on). */
  getDependencies(id: ArtifactId): DependencyEdge[] {
    const out = this.outgoing.get(id);
    if (!out) return [];
    const edges: DependencyEdge[] = [];
    for (const [to, kinds] of out) {
      for (const kind of kinds) edges.push({ from: id, to, kind });
    }
    return edges;
  }

  /**
   * BFS for downstream nodes (those that depend on `id`), up to `maxDepth`
   * hops. Each result carries the hop count so the broadcast layer can apply
   * the depth cap from spec 060.
   */
  getDownstream(
    id: ArtifactId,
    maxDepth: number = MAX_NOTICE_HOPS,
  ): { artifactId: ArtifactId; hops: number; kind: DepKind }[] {
    if (maxDepth <= 0) return [];
    const seen = new Set<ArtifactId>([id]);
    const out: { artifactId: ArtifactId; hops: number; kind: DepKind }[] = [];
    let frontier: { artifactId: ArtifactId; kind: DepKind }[] = [];
    const initial = this.incoming.get(id);
    if (initial) {
      for (const [from, kinds] of initial) {
        for (const kind of kinds) frontier.push({ artifactId: from, kind });
      }
    }
    for (let hop = 1; hop <= maxDepth && frontier.length > 0; hop++) {
      const next: { artifactId: ArtifactId; kind: DepKind }[] = [];
      for (const { artifactId, kind } of frontier) {
        if (seen.has(artifactId)) continue;
        seen.add(artifactId);
        out.push({ artifactId, hops: hop, kind });
        if (hop < maxDepth) {
          const further = this.incoming.get(artifactId);
          if (further) {
            for (const [from, kinds] of further) {
              for (const k of kinds) next.push({ artifactId: from, kind: k });
            }
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  /** All currently-stored nodes. */
  nodes_(): ArtifactNode[] {
    return Array.from(this.nodes.values());
  }

  /** All currently-stored edges, flat. */
  edges(): DependencyEdge[] {
    const out: DependencyEdge[] = [];
    for (const [from, kindsByTo] of this.outgoing) {
      for (const [to, kinds] of kindsByTo) {
        for (const kind of kinds) out.push({ from, to, kind });
      }
    }
    return out;
  }

  // ── reducer ───────────────────────────────────────────────────────────────

  /**
   * Apply one `AgentEvent` and return the notices the broadcast layer should
   * surface. Handles `declare_dependency` and `artifact`; other event types
   * are passed through with no notices.
   */
  applyEvent(event: AgentEvent, at: Date = new Date()): DepChangedNotice[] {
    if (event.type === 'declare_dependency') {
      this.addDependency(
        event.from as ArtifactId,
        event.to as ArtifactId,
        event.kind,
      );
      return [];
    }
    if (event.type === 'artifact') {
      return this.onArtifactObserved(event.artifact, at);
    }
    return [];
  }

  /** Public entry the file_change → artifact watcher (#41) calls. */
  onArtifactObserved(artifact: Artifact, at: Date = new Date()): DepChangedNotice[] {
    const result = this.recordArtifact(artifact, at);
    if (!result.isNewVersion) return [];

    const previousVersion = result.previousVersion ?? artifact.version - 1;
    const downstream = this.getDownstream(artifact.id, MAX_NOTICE_HOPS);
    return downstream.map((d) => {
      const downstreamNode = this.nodes.get(d.artifactId);
      const upstreamNode = this.nodes.get(artifact.id);
      return {
        upstream: {
          artifactId: artifact.id,
          ...(upstreamNode?.title !== undefined ? { title: upstreamNode.title } : {}),
          ownerAgentId: artifact.ownerAgentId,
          fromVersion: previousVersion,
          toVersion: artifact.version,
        },
        downstream: {
          artifactId: d.artifactId,
          ...(downstreamNode?.title !== undefined ? { title: downstreamNode.title } : {}),
          ownerAgentId: downstreamNode?.ownerAgentId ?? 'unknown',
          hopsFromChange: d.hops,
        },
        kind: d.kind,
      };
    });
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function getOrCreate<K, V extends Map<unknown, unknown>>(
  map: Map<K, V>,
  key: K,
): V {
  let v = map.get(key);
  if (!v) {
    v = new Map() as V;
    map.set(key, v);
  }
  return v;
}

function addToNested(
  map: Map<ArtifactId, Map<ArtifactId, Set<DepKind>>>,
  outer: ArtifactId,
  inner: ArtifactId,
  kind: DepKind,
): void {
  const innerMap = getOrCreate(map, outer);
  let kinds = innerMap.get(inner);
  if (!kinds) {
    kinds = new Set();
    innerMap.set(inner, kinds);
  }
  kinds.add(kind);
}
