# Spec 120: HandoffCard V2

> **Status: DRAFT for review.** Created from the v0.2 roadmap (#155) and next-step
> issue #149. Builds on spec 030 (HandoffCard) and spec 110 (Missions). HandoffCard
> V2 is the bridge object between Workflow, Mission, Agent routing, and the
> Artifact graph.

## 1. Why V2

The v1 HandoffCard (spec 030) made context transfer a readable, editable,
auditable card. V2 keeps that readable experience but turns the card into a
structured collaboration object that can:

- belong to a Mission and reference prior tasks and artifacts by id;
- carry an explicit *protocol layer* a downstream agent consumes directly;
- track task lifecycle state across a multi-stage mission.

A2A is the **design inspiration only** — `task` + `contextId`, `referenceTaskIds`,
and the task-state enum mirror A2A's Task / contextId / TaskState. We do not aim
for protocol compliance.

## 2. Two layers

| Layer | Audience | Purpose |
| --- | --- | --- |
| **human** | the user | `userIntent`, `taskBrief`, `summary`, `openQuestions`, `rolesInGroup` — the readable card. |
| **protocol** | the downstream agent | `task`, `referenceTaskIds`, `contextPackage`, `nextAction`, `risks` — the minimum-sufficient machine context. |

## 3. Shape

```ts
interface HandoffCardV2 {
  protocolVersion: 2;
  cardId: string;
  missionId?: MissionId;
  scenario: HandoffScenario;        // reused from spec 030
  fromAgent: string;
  toAgent: string;
  sourceTaskId?: string;            // the task this card hands off from
  referenceTaskIds: string[];       // prior tasks this card depends on
  task: HandoffTaskRef;             // A2A Task-inspired: { taskId, contextId?, title?, state? }
  human: HandoffHumanLayer;
  contextPackage: HandoffContextPackage;
  artifacts: ArtifactRef[];         // produced/handed outputs — refs only
  nextAction: { instruction; acceptanceCriteria[] };
  risks: { severity: low|medium|high; description }[];
  provenance: { generatedBy: orchestrator|agent|user; sourceAgentId?; sourceAgentRole? };
  createdAt: Date;
}
```

`contextPackage` = `{ pinnedMessages (≤10), taskReferences, artifactRefs, audit?, fullHistoryRef }`.

## 4. Token discipline

Inherits spec 030's rules. The protocol layer (`toHandoffV2ProtocolPayload`)
carries **references only**: pinned constraints as text, artifacts and tasks as
ids, never raw history or artifact bodies. The downstream agent calls
`read_artifact(id)` for content and resolves task ids against the Mission.

## 5. Legacy compatibility

Two pure bridges live in `src/contracts/handoff-v2.ts`:

- `handoffCardV2ToLegacy(card)` → a v1 `HandoffCard` so the existing card UI
  (`src/ui/components/cards.jsx`) renders V2 without code changes. Lossy: protocol
  fields collapse into the readable shape.
- `handoffCardToV2(card, opts?)` → upgrades a stored v1 card into V2 so older
  logs and records flow through the V2 surface. Best-effort: the card id stands
  in as the task reference.

`provenance` reserves a slot for the AgentCard snapshot that lands in #152.

## 6. Non-goals

- No A2A protocol compliance; concepts only.
- No artifact bodies in the protocol layer — refs only.
- No raw chat history forwarded to downstream agents.
- Orchestrator emission of V2 cards on the live path is out of scope here; this
  spec defines the contract, bridges, and protocol-payload extractor.

## 7. Open questions

- Should `referenceTaskIds` be resolved into full `taskReferences` at build time
  or lazily by the consumer against the Mission?
- Does the edit-before-dispatch flow (spec 030) edit the human layer, the
  protocol layer, or both?
