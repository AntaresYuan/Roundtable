import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import type { AdapterRegistry } from '../adapters/index.js';
import type { Db } from '../db/index.js';
import { DependencyGraph } from './dependency-graph.js';
import type { DependencyStore } from './dependency-store.js';
import type { ArtifactWatcherContext } from './artifact-watcher.js';
import { type HandoffLog, inMemoryHandoffLog } from './handoff-log.js';
import { runAggregate } from './nodes/aggregate.js';
import type { SkillProposer } from './nodes/skill-proposer.js';
import { type ClarifyGenerator, fallbackClarify, runClarify } from './nodes/clarify.js';
import { runDispatch, type WorkspaceResolver } from './nodes/dispatch.js';
import type { HandoffGeneratorOptions } from './handoff.js';
import { heuristicIntake, type IntakeClassifier, runIntake } from './nodes/intake.js';
import { type Planner, rolePlanner, runPlan } from './nodes/plan.js';
import { noopReviewer, type Reviewer, runReview } from './nodes/review.js';
import { runGatePause } from './nodes/gate.js';
import {
  initialState,
  type AggregateSummary,
  type ClarifyState,
  type DispatchRecord,
  type GateDecision,
  type OrchestratorState,
  type PendingGate,
  type ProposeSkillEvent,
  type StageId,
} from './state.js';
import type {
  AutonomyPolicy,
  Artifact,
  HandoffCard,
  IntakeResult,
  Plan,
  ReviewComment,
  Workflow,
} from '../contracts/index.js';

export interface GraphDeps {
  registry: AdapterRegistry;
  workspaces: WorkspaceResolver;
  intake?: IntakeClassifier;
  clarify?: ClarifyGenerator;
  planner?: Planner;
  reviewer?: Reviewer;
  skillProposer?: SkillProposer | undefined;
  handoffLog?: HandoffLog;
  handoff?: HandoffGeneratorOptions;
  checkpointer?: BaseCheckpointSaver;
  dependencyGraph?: DependencyGraph;
  dependencyStore?: DependencyStore;
  artifactDb?: ArtifactWatcherContext['db'];
  pinnedDb?: Db;
}

const lastWins = <T>() => ({ reducer: (_prev: T, next: T) => next });

const StateAnnotation = Annotation.Root({
  chatId: Annotation<string>(lastWins<string>()),
  userMessage: Annotation<string>(lastWins<string>()),
  stage: Annotation<StageId>(lastWins<StageId>()),
  workflow: Annotation<Workflow | undefined>(lastWins<Workflow | undefined>()),
  intake: Annotation<IntakeResult | undefined>(lastWins<IntakeResult | undefined>()),
  clarify: Annotation<ClarifyState | undefined>(lastWins<ClarifyState | undefined>()),
  plan: Annotation<Plan | undefined>(lastWins<Plan | undefined>()),
  handoffCards: Annotation<HandoffCard[]>(lastWins<HandoffCard[]>()),
  dispatch: Annotation<DispatchRecord[]>(lastWins<DispatchRecord[]>()),
  artifacts: Annotation<Artifact[]>(lastWins<Artifact[]>()),
  reviewComments: Annotation<ReviewComment[]>(lastWins<ReviewComment[]>()),
  proposedSkills: Annotation<ProposeSkillEvent[]>(lastWins<ProposeSkillEvent[]>()),
  autonomyPolicy: Annotation<OrchestratorState['autonomyPolicy']>(
    lastWins<OrchestratorState['autonomyPolicy']>(),
  ),
  autonomyDecisions: Annotation<OrchestratorState['autonomyDecisions']>(
    lastWins<OrchestratorState['autonomyDecisions']>(),
  ),
  pendingGate: Annotation<PendingGate | undefined>(lastWins<PendingGate | undefined>()),
  pendingRecovery: Annotation<OrchestratorState['pendingRecovery']>(
    lastWins<OrchestratorState['pendingRecovery']>(),
  ),
  failureRecoveryCards: Annotation<OrchestratorState['failureRecoveryCards']>(
    lastWins<OrchestratorState['failureRecoveryCards']>(),
  ),
  gateDecisions: Annotation<Record<string, GateDecision>>(
    lastWins<Record<string, GateDecision>>(),
  ),
  aggregate: Annotation<AggregateSummary | undefined>(lastWins<AggregateSummary | undefined>()),
  errors: Annotation<OrchestratorState['errors']>(lastWins<OrchestratorState['errors']>()),
});

type GraphState = typeof StateAnnotation.State;

// LangGraph forbids node names that collide with channel names. Prefix with
// `stage:` so they cannot clash with the StateAnnotation keys (intake, plan…).
const N = {
  intake: 'stage_intake',
  clarify: 'stage_clarify',
  await_user: 'stage_await_user',
  plan: 'stage_plan',
  dispatch: 'stage_dispatch',
  monitor: 'stage_monitor',
  review: 'stage_review',
  gate: 'stage_gate',
  recovery: 'stage_recovery',
  aggregate: 'stage_aggregate',
} as const;

type StageNode = (typeof N)[keyof typeof N];

/**
 * Build a LangGraph StateGraph that mirrors the 7-stage orchestrator
 * (intake → clarify → plan → dispatch → monitor → review → aggregate).
 *
 * Node functions stay pure — the graph only wires them. Conditional edges
 * inspect `state.stage` (set by each node) to route to the next node.
 * `interrupt()` is used to pause when clarify questions remain unanswered.
 */
export function buildOrchestratorGraph(deps: GraphDeps) {
  const intake = deps.intake ?? heuristicIntake();
  const clarify = deps.clarify ?? fallbackClarify();
  const planner = deps.planner ?? rolePlanner();
  const reviewer = deps.reviewer ?? noopReviewer();
  const handoffLog = deps.handoffLog ?? inMemoryHandoffLog();
  const checkpointer = deps.checkpointer ?? new MemorySaver();
  const dependencyGraph = deps.dependencyGraph ?? new DependencyGraph();

  const adapt = (s: GraphState): OrchestratorState => s as unknown as OrchestratorState;

  const graph = new StateGraph(StateAnnotation)
    .addNode(N.intake, async (s: GraphState) => await runIntake(adapt(s), intake))
    .addNode(N.clarify, async (s: GraphState) => await runClarify(adapt(s), clarify))
    .addNode(N.await_user, async (s: GraphState) => {
      // Separate node so the `clarify` state is already persisted in the
      // checkpoint before we block — otherwise the caller can't see the
      // questions after `getState`.
      if (s.clarify?.resolved) return {};
      const answers = interrupt({
        kind: 'clarify',
        questions: s.clarify?.questions ?? [],
      }) as Record<string, string> | undefined;
      if (!answers || !s.clarify) return {};
      const resolved = s.clarify.questions.every((q) => q.id in answers);
      return {
        clarify: { ...s.clarify, answers, resolved },
        stage: (resolved ? 'plan' : 'clarify') as StageId,
      };
    })
    .addNode(N.plan, async (s: GraphState) => await runPlan(adapt(s), planner))
    .addNode(N.dispatch, async (s: GraphState) =>
      await runDispatch(adapt(s), {
        registry: deps.registry,
        workspaces: deps.workspaces,
        handoffLog,
        ...(deps.handoff ? { handoff: deps.handoff } : {}),
        dependencyGraph,
        ...(deps.dependencyStore ? { dependencyStore: deps.dependencyStore } : {}),
        ...(deps.artifactDb ? { artifactDb: deps.artifactDb } : {}),
        ...(deps.pinnedDb ? { pinnedDb: deps.pinnedDb } : {}),
      }),
    )
    .addNode(N.monitor, async (s: GraphState) => ({ ...s, stage: 'review' as StageId }))
    .addNode(N.review, async (s: GraphState) => await runReview(adapt(s), reviewer))
    .addNode(N.gate, async (s: GraphState) => runGatePause(adapt(s)))
    .addNode(N.recovery, async (s: GraphState) => {
      if (!s.pendingRecovery) return { stage: 'aggregate' as StageId };
      interrupt({
        kind: 'failure_recovery',
        card: s.pendingRecovery,
      });
      return {};
    })
    .addNode(N.aggregate, async (s: GraphState) =>
      runAggregate(adapt(s), deps.skillProposer),
    )
    .addEdge(START, N.intake)
    .addConditionalEdges(N.intake, route, [
      N.clarify,
      N.plan,
      N.dispatch,
      N.monitor,
      N.review,
      N.gate,
      N.recovery,
      N.aggregate,
      END,
    ])
    .addEdge(N.clarify, N.await_user)
    .addConditionalEdges(
      N.await_user,
      (s: GraphState) => (s.clarify?.resolved ? N.plan : END),
      [N.plan, END],
    )
    .addConditionalEdges(N.plan, route, [
      N.dispatch,
      N.monitor,
      N.review,
      N.gate,
      N.recovery,
      N.aggregate,
      END,
    ])
    .addConditionalEdges(N.dispatch, route, [
      N.monitor,
      N.review,
      N.gate,
      N.recovery,
      N.aggregate,
      END,
    ])
    .addConditionalEdges(N.monitor, route, [N.review, N.gate, N.recovery, N.aggregate, END])
    .addConditionalEdges(N.review, route, [N.gate, N.recovery, N.aggregate, END])
    .addConditionalEdges(N.gate, route, [N.dispatch, N.review, N.recovery, N.aggregate, END])
    .addConditionalEdges(N.recovery, route, [N.aggregate, END])
    .addConditionalEdges(N.aggregate, route, [END]);

  return graph.compile({ checkpointer });
}

function route(s: GraphState): StageNode | typeof END {
  switch (s.stage) {
    case 'intake':
      return N.intake;
    case 'clarify':
      return N.clarify;
    case 'plan':
      return N.plan;
    case 'dispatch':
      return N.dispatch;
    case 'monitor':
      return N.monitor;
    case 'review':
      return N.review;
    case 'gate':
      return N.gate;
    case 'recovery':
      return N.recovery;
    case 'aggregate':
      return N.aggregate;
    case 'done':
      return END;
  }
}

export function buildInitialInput(
  chatId: string,
  userMessage: string,
  workflow?: Workflow,
  autonomyPolicy?: AutonomyPolicy,
): OrchestratorState {
  return initialState(chatId, userMessage, workflow, autonomyPolicy);
}

export { StateAnnotation };
