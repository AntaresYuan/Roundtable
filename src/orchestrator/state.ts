import type {
  AgentDescription,
  AgentEvent,
  HandoffCard,
  IntakeResult,
  Plan,
  PlanTaskStatus,
  SelectorDecision,
} from '../contracts/index.js';

export type StageId =
  | 'select_speaker'
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
  /** Agents present in this chat — drives the group-chat selector node. */
  agents?: AgentDescription[];
  /** Last selector decision (when group-chat routing fires). */
  selector?: SelectorDecision;
  intake?: IntakeResult;
  clarify?: ClarifyState;
  plan?: Plan;
  handoffCards: HandoffCard[];
  dispatch: DispatchRecord[];
  reviewNotes: string[];
  aggregate?: AggregateSummary;
  errors: { stage: StageId; message: string }[];
}

export function initialState(
  chatId: string,
  userMessage: string,
  opts: { agents?: AgentDescription[] } = {},
): OrchestratorState {
  // Group-chat routing kicks in when ≥ 2 agents are in the room AND the
  // user didn't disambiguate with an `@mention`. Otherwise start at intake
  // (existing single-chat / PM flow).
  const useSelector =
    opts.agents !== undefined && opts.agents.length >= 2 && !MENTION_RE.test(userMessage);
  return {
    chatId,
    userMessage,
    stage: useSelector ? 'select_speaker' : 'intake',
    ...(opts.agents !== undefined ? { agents: opts.agents } : {}),
    handoffCards: [],
    dispatch: [],
    reviewNotes: [],
    errors: [],
  };
}

const MENTION_RE = /(^|\s)@\w+/;

/** Expose for tests + the graph routing helper. */
export function hasMention(message: string): boolean {
  return MENTION_RE.test(message);
}
