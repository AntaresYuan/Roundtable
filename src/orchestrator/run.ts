import type { AdapterRegistry } from '../adapters/index.js';
import { type HandoffLog, inMemoryHandoffLog } from './handoff-log.js';
import { runAggregate } from './nodes/aggregate.js';
import { type ClarifyGenerator, fallbackClarify, runClarify } from './nodes/clarify.js';
import { runDispatch, type WorkspaceResolver } from './nodes/dispatch.js';
import { heuristicIntake, type IntakeClassifier, runIntake } from './nodes/intake.js';
import { type Planner, rolePlanner, runPlan } from './nodes/plan.js';
import { noopReviewer, type Reviewer, runReview } from './nodes/review.js';
import { initialState, type OrchestratorState } from './state.js';

export interface OrchestratorDeps {
  registry: AdapterRegistry;
  workspaces: WorkspaceResolver;
  intake?: IntakeClassifier;
  clarify?: ClarifyGenerator;
  planner?: Planner;
  reviewer?: Reviewer;
  handoffLog?: HandoffLog;
}

export interface RunOptions {
  chatId: string;
  userMessage: string;
}

const MAX_STAGE_TRANSITIONS = 32;

export async function runOrchestrator(
  opts: RunOptions,
  deps: OrchestratorDeps,
): Promise<OrchestratorState> {
  const intake = deps.intake ?? heuristicIntake();
  const clarify = deps.clarify ?? fallbackClarify();
  const planner = deps.planner ?? rolePlanner();
  const reviewer = deps.reviewer ?? noopReviewer();
  const handoffLog = deps.handoffLog ?? inMemoryHandoffLog();

  let state = initialState(opts.chatId, opts.userMessage);

  for (let i = 0; i < MAX_STAGE_TRANSITIONS; i++) {
    if (state.stage === 'done') return state;

    switch (state.stage) {
      case 'intake':
        state = await runIntake(state, intake);
        break;
      case 'clarify':
        state = await runClarify(state, clarify);
        if (state.stage === 'clarify') return state;
        break;
      case 'plan':
        state = await runPlan(state, planner);
        break;
      case 'dispatch':
        state = await runDispatch(state, {
          registry: deps.registry,
          workspaces: deps.workspaces,
          handoffLog,
        });
        break;
      case 'monitor':
        state = { ...state, stage: 'review' };
        break;
      case 'review':
        state = await runReview(state, reviewer);
        break;
      case 'aggregate':
        state = runAggregate(state);
        break;
    }
  }

  throw new Error(`orchestrator did not converge after ${MAX_STAGE_TRANSITIONS} transitions`);
}
