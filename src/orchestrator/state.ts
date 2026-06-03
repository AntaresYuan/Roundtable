import type {
  AgentEvent,
  Artifact,
  HandoffCard,
  IntakeResult,
  Plan,
  PlanTaskStatus,
} from '../contracts/index.js';

export type StageId =
  | 'intake'
  | 'clarify'
  | 'plan'
  | 'dispatch'
  | 'monitor'
  | 'review'
  | 'aggregate'
  | 'done';

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
  intake?: IntakeResult;
  clarify?: ClarifyState;
  plan?: Plan;
  handoffCards: HandoffCard[];
  dispatch: DispatchRecord[];
  artifacts: Artifact[];
  reviewNotes: string[];
  aggregate?: AggregateSummary;
  errors: { stage: StageId; message: string }[];
}

export function initialState(chatId: string, userMessage: string): OrchestratorState {
  return {
    chatId,
    userMessage,
    stage: 'intake',
    handoffCards: [],
    dispatch: [],
    artifacts: [],
    reviewNotes: [],
    errors: [],
  };
}
