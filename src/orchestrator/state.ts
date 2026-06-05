import type {
  AgentEvent,
  Artifact,
  AutonomyDecision,
  AutonomyPolicy,
  Gate,
  FailureRecoveryCard,
  HandoffCard,
  IntakeResult,
  Plan,
  PlanTaskStatus,
  ReviewComment,
  Workflow,
} from '../contracts/index.js';
import { DEFAULT_AUTONOMY_POLICY as DEFAULT_POLICY } from '../contracts/index.js';

export type StageId =
  | 'intake'
  | 'clarify'
  | 'plan'
  | 'dispatch'
  | 'monitor'
  | 'review'
  | 'gate'
  | 'recovery'
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

export type ProposeSkillEvent = Extract<AgentEvent, { type: 'propose_skill' }>;

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
  /**
   * PM-emitted `propose_skill` events from the aggregate stage (#100 / #119).
   * UI surfaces these as "Save as my skill" prompts; nothing persists until
   * the user confirms via `userSkills.create` (ADR-007).
   */
  proposedSkills: ProposeSkillEvent[];
  autonomyPolicy: AutonomyPolicy;
  autonomyDecisions: AutonomyDecision[];
  pendingGate: PendingGate | undefined;
  pendingRecovery: FailureRecoveryCard | undefined;
  failureRecoveryCards: FailureRecoveryCard[];
  gateDecisions: Record<string, GateDecision>;
  aggregate?: AggregateSummary;
  errors: { stage: StageId; message: string }[];
}

export function initialState(
  chatId: string,
  userMessage: string,
  workflow?: Workflow,
  autonomyPolicy: AutonomyPolicy = DEFAULT_POLICY,
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
    proposedSkills: [],
    autonomyPolicy,
    autonomyDecisions: [],
    pendingGate: undefined,
    pendingRecovery: undefined,
    failureRecoveryCards: [],
    gateDecisions: {},
    errors: [],
  };
}
