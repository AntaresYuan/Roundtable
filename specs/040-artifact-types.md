# Spec 040: Artifact Types & Rendering

## Goal

Define the canonical artifact types each adapter can emit, and the single React dispatcher that renders them. Artifacts are first-class objects — versioned, owned by an agent, dependency-aware.

## Non-goals

- Not how dependencies are computed (see spec 060).
- Not how the sandbox is provisioned (see ADR-005).

## Data shape

```ts
type Artifact = { meta: ArtifactMeta; body: ArtifactBody };

interface ArtifactMeta {
  id: string;
  agentId: string;        // ownership → drives color
  agentColor: string;
  version: number;
  parentVersion?: number;
  createdAt: Date;
  title: string;
  dependencies?: ArtifactDep[];
}

type ArtifactBody =
  | { kind: 'code';     path: string; language: string; content: string }
  | { kind: 'diff';     oldContent: string; newContent: string; path: string }
  | { kind: 'web_app';  files: FileTree; entrypoint: string; sandboxUrl?: string }
  | { kind: 'markdown'; content: string }
  | { kind: 'mermaid';  content: string }
  | { kind: 'html';     content: string }
  | { kind: 'spec';     content: string; meta: { goal: string; acceptance: string[] } };
```

## Rendering strategy

A single `<ArtifactRenderer artifact={...} />` switches on `body.kind`:

| Kind | Renderer | Notes |
|---|---|---|
| `code` | Monaco editor | Read-only by default; edit-in-place if owner. |
| `diff` | Monaco diff viewer | Multi-author lines colored by author. |
| `web_app` | e2b sandbox `<iframe>` | Live preview; falls back to file tree if sandbox over budget. |
| `markdown` | `react-markdown` + GFM | Tables, task lists, syntax-highlighted code. |
| `mermaid` | `mermaid` client lib | Renders to SVG. |
| `html` | sandboxed `<iframe>` | `sandbox="allow-scripts"` only; no parent access. |
| `spec` | Structured card | Title, goal, acceptance criteria as checklist. |

## Ownership & color

- Color comes from `meta.agentColor`. Set at agent creation; user-pickable or hash-derived.
- Card chrome: 1px colored border on the left, agent avatar + role tag top-left.

## Versioning

- Every change to an artifact creates a new version, not a new artifact. `parentVersion` chains form the history.
- The chat shows the **latest** version inline; older versions accessed via a timeline drawer.
- Cross-agent edits to the same artifact: diff lines are colored per author for visual ownership.

## Hybrid rendering policy (cost control)

- `web_app` → e2b sandbox (live).
- Everything else → static client-side rendering.
- If e2b is unavailable or quota-exhausted, `web_app` degrades to a code view of `entrypoint`.

## Acceptance criteria

- [ ] All 7 kinds render without runtime errors against the fixture set in `tests/artifacts/fixtures/`.
- [ ] Multi-author diffs render with at least 2 distinct author colors.
- [ ] Sandbox iframe respects `sandbox` attribute on every render path.
- [ ] Version timeline shows ≥ 5 versions without layout breakage.

## Open questions

- Should `spec` artifacts be editable inline (live spec authoring)? v1: read-only.

## Changelog

- 2026-05-24 — initial draft.
