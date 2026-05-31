import type { ArtifactId, DepKind } from '../contracts/index.js';
import type { DependencyGraph } from './dependency-graph.js';

/**
 * Thin abstraction over the `artifact_deps` table so the orchestrator can
 * be wired with either a real Drizzle client or an in-memory test fake.
 *
 * The full Drizzle type is intentionally erased here to keep this module
 * dependency-light — callers pass an object that implements `selectAll`
 * and `insertOne` against the canonical row shape.
 */
export interface DependencyEdgeRow {
  fromArtifactId: ArtifactId;
  toArtifactId: ArtifactId;
  kind: DepKind;
}

export interface DependencyStore {
  /** Return every persisted edge. Used to hydrate the in-memory graph on boot. */
  selectAll(): Promise<DependencyEdgeRow[]>;
  /** Persist one edge. Should be idempotent (the table's PK is from+to+kind). */
  insertOne(row: DependencyEdgeRow): Promise<void>;
}

/** In-memory store for tests; persists nothing beyond process lifetime. */
export function inMemoryDependencyStore(
  seed: DependencyEdgeRow[] = [],
): DependencyStore {
  const rows: DependencyEdgeRow[] = [...seed];
  return {
    async selectAll() {
      return [...rows];
    },
    async insertOne(row) {
      const dup = rows.some(
        (r) =>
          r.fromArtifactId === row.fromArtifactId &&
          r.toArtifactId === row.toArtifactId &&
          r.kind === row.kind,
      );
      if (!dup) rows.push(row);
    },
  };
}

/** Hydrate an empty graph from the store. Idempotent. */
export async function hydrateDependencyGraph(
  graph: DependencyGraph,
  store: DependencyStore,
): Promise<number> {
  const rows = await store.selectAll();
  let added = 0;
  for (const row of rows) {
    if (graph.addDependency(row.fromArtifactId, row.toArtifactId, row.kind)) {
      added += 1;
    }
  }
  return added;
}

/**
 * Apply one declared edge to both the in-memory graph and the persisted
 * store. Use this whenever the orchestrator observes a `declare_dependency`
 * event from an agent.
 */
export async function persistDependency(
  graph: DependencyGraph,
  store: DependencyStore,
  row: DependencyEdgeRow,
): Promise<void> {
  if (graph.addDependency(row.fromArtifactId, row.toArtifactId, row.kind)) {
    await store.insertOne(row);
  }
}
