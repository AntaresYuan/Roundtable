import { randomUUID } from 'node:crypto';
import type {
  AgentDescription,
  AgentRoleId,
  ChatId,
  Plan,
} from '../../contracts/index.js';
import type { SelectorTelemetry } from '../selector-log.js';
import { runSelector, type SpeakerSelector } from './selector.js';
import { hasMention, type OrchestratorState, type StageId } from '../state.js';

export interface SelectSpeakerDeps {
  selector?: SpeakerSelector;
  telemetry?: SelectorTelemetry;
  confidenceThreshold?: number;
}

/**
 * Graph node that decides who replies next when the user posts in a
 * group chat without an `@mention`. Three outcomes:
 *
 * 1. **High-confidence pick** → skip PM planning, synthesize a single-task
 *    plan addressed to the chosen agent's role, set `stage='dispatch'`.
 * 2. **Low-confidence pick in a large room** → set a clarify state holding
 *    the "did you mean @X or @Y?" question, `stage='clarify'`.
 * 3. **No agents / no match / explicit `@`** → fall through to the existing
 *    PM flow, `stage='intake'`. Existing single-chat tests are unaffected.
 */
export async function runSelectSpeaker(
  state: OrchestratorState,
  deps: SelectSpeakerDeps,
): Promise<OrchestratorState> {
  const agents = state.agents ?? [];

  // Defensive fall-through — should never fire in prod because `initialState`
  // routes to `intake` directly, but keeps the node safe if it's reached
  // mid-graph via a checkpoint replay with stale state.
  if (agents.length < 2 || hasMention(state.userMessage)) {
    return { ...state, stage: 'intake' };
  }

  const result = await runSelector(
    { userMessage: state.userMessage, agents },
    {
      chatId: state.chatId as ChatId,
      ...(deps.selector ? { selector: deps.selector } : {}),
      ...(deps.telemetry ? { telemetry: deps.telemetry } : {}),
      ...(deps.confidenceThreshold !== undefined
        ? { confidenceThreshold: deps.confidenceThreshold }
        : {}),
    },
  );

  if (result.fallbackTriggered && result.clarifyQuestion) {
    return {
      ...state,
      selector: result.decision,
      clarify: {
        questions: [result.clarifyQuestion],
        answers: {},
        resolved: false,
      },
      stage: 'clarify' as StageId,
    };
  }

  if (result.decision.chosenAgentId === null) {
    // No agent matched — defer to the PM flow.
    return { ...state, selector: result.decision, stage: 'intake' };
  }

  const chosen = agents.find((a) => a.id === result.decision.chosenAgentId);
  if (!chosen) {
    // The selector returned an id we didn't seed — shouldn't happen because
    // `llmSelector` validates against the roster, but be defensive.
    return { ...state, selector: result.decision, stage: 'intake' };
  }

  return {
    ...state,
    selector: result.decision,
    plan: synthesizePlanForAgent(state.userMessage, chosen),
    stage: 'dispatch' as StageId,
  };
}

function synthesizePlanForAgent(userMessage: string, agent: AgentDescription): Plan {
  const role: AgentRoleId = agent.role;
  return {
    id: randomUUID(),
    createdAt: new Date(),
    tasks: [
      {
        id: 'T1',
        title: userMessage,
        assignee: role,
        deps: [],
        parallel: false,
        user_visible: true,
        status: 'pending',
      },
    ],
  };
}
