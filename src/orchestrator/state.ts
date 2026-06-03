import type {
  AgentEvent,
  Artifact,
  Gate,
  HandoffCard,
  IntakeResult,
  Plan,
  PlanTaskStatus,
  ReviewComment,
  Workflow,
} from '../contracts/index.js';

export type StageId =
  | 'intake'
  | 'clarify'
  | 'plan'
  | 'dispatch'
  | 'monitor'
  | 'review'
  | 'gate'
  | 'aggregate'
  | 'done';

export type GateDecision = 'approve' | 'request_changes';

export interface PendingGate {
  stageId: string;
  gate: Gate;
}

export interface ClarifyQuestion {
  id: string;
  prompt: string;
  options: { id: string; label: string }[];
}

export interface ClarifyState {
  questions: ClarifyQuestion[];
  answers: Record<string, string>;
  resolved: boolean;
}

export interface DispatchRecord {
  taskId: string;
  handoffCardId: string;
  sessionId: string;
  status: PlanTaskStatus;
  events: AgentEvent[];
  startedAt: Date;
  finishedAt?: Date;
}

export interface AggregateSummary {
  headline: string;
  bullets: string[];
  quickActions: { id: string; label: string }[];
}

export interface OrchestratorState {
  chatId: string;
  userMessage: string;
  stage: StageId;
  workflow?: Workflow;
  intake?: IntakeResult;
  clarify?: ClarifyState;
  plan?: Plan;
  handoffCards: HandoffCard[];
  dispatch: DispatchRecord[];
  artifacts: Artifact[];
  reviewNotes: string[];
  reviewComments: ReviewComment[];
  pendingGate: PendingGate | undefined;
  gateDecisions: Record<string, GateDecision>;
  aggregate?: AggregateSummary;
  errors: { stage: StageId; message: string }[];
}

export function initialState(
  chatId: string,
  userMessage: string,
  workflow?: Workflow,
): OrchestratorState {
  return {
    chatId,
    userMessage,
    stage: 'intake',
    ...(workflow ? { workflow } : {}),
    handoffCards: [],
    dispatch: [],
    artifacts: [],
    reviewNotes: [],
    reviewComments: [],
    pendingGate: undefined,
    gateDecisions: {},
    errors: [],
  };
}
