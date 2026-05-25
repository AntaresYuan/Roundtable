# Spec 060: Artifact Dependency Graph

## Goal

Track and surface dependencies between artifacts so that when an upstream artifact changes, downstream consumers see a visible "dependency changed" badge and the user can trigger a sync with one click.

## Non-goals

- Not a build system. We do not re-compile or auto-fix downstream artifacts.
- Not an import analyzer. We do not parse code to infer edges (rejected: see "Approach" below).

## Why this matters

This is the *single feature* that makes Roundtable a multi-agent **collaboration** platform rather than a parallel-execution platform. Cursor / v0 / Bolt / Coze do not have first-class artifact dependencies.

## Approach (mixed)

| Source of edges | Used? | Notes |
|---|---|---|
| **Agent self-declaration** via a `<dependencies>` block in agent prompt + `declare_dependency` event | ✅ Primary | Cheap, controllable, agents are taught via system-prompt template. |
| **Orchestrator broadcast** on artifact change | ✅ Backup | When no edges exist for a changed artifact, PM posts: "@frontend `backend/api.ts` changed — your `LoginForm.tsx` may need a sync." |
| **LLM post-hoc import analysis** | ❌ Rejected for v1 | Too token-heavy and error-prone for the 3-week sprint. Revisit later. |

## Graph model

In-memory graph maintained by the Orchestrator:

```ts
interface DependencyGraph {
  nodes: Map<ArtifactId, ArtifactNode>;
  edges: Map<ArtifactId, Set<{ to: ArtifactId; kind: DepKind }>>;
}

type DepKind = 'imports' | 'calls' | 'extends' | 'references';
```

Persisted to Postgres (`artifact_deps` table) for durability; in-memory cache for hot reads.

## Triggering & UI

- On `artifact` event with `version > 1`, the graph reducer enqueues a `dep-changed` job.
- For each downstream node, the consumer artifact card surfaces a red badge: `⚠️ dependency changed`.
- Badge action: `[Ask @<owner-agent> to sync]` — triggers the owner agent to re-enter the chat with a HandoffCard pre-filled with the upstream change summary.
- A collapsible sidebar mini-graph (React Flow / Dagre) shows the live graph; clicking a node deep-links to the artifact.

## Cost control

- Maximum graph depth surfaced in UI: 2 hops from the changed node.
- No automatic notifications past depth 2 — the user can click through.

## Acceptance criteria

- [ ] When an upstream artifact bumps version, every direct downstream surfaces a badge within 1s.
- [ ] `Ask @agent to sync` button produces a HandoffCard with `previousAgent.summary` describing the upstream change.
- [ ] Mini-graph renders correctly for graphs up to 20 nodes without performance issues.

## Open questions

- Should we visualize cyclic dependencies as warnings? v1: yes, render edges red and surface a one-line notice.

## Changelog

- 2026-05-24 — initial draft.
