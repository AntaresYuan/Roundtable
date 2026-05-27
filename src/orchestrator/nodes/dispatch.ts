import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentRoleId,
  HandoffCard,
  PlanTask,
} from '../../contracts/index.js';
import type { AdapterRegistry } from '../../adapters/index.js';
import type { HandoffLog } from '../handoff-log.js';
import type { DispatchRecord, OrchestratorState } from '../state.js';

export interface WorkspaceResolver {
  resolve(chatId: string): string;
}

export function buildHandoffCard(
  state: OrchestratorState,
  task: PlanTask,
  role: AgentRoleId,
): HandoffCard {
  return {
    id: randomUUID() as string,
    from: 'orchestrator',
    to: role,
    scenario: 'dispatch',
    userIntent: state.intake?.userVisibleSummary ?? state.userMessage,
    taskBrief: task.title,
    pinnedMessages: [],
    rolesInGroup: [],
    relevantArtifacts: [],
    fullHistoryRef: `chat:${state.chatId}`,
    createdAt: new Date(),
    generatedBy: 'orchestrator',
  };
}

export interface DispatchDeps {
  registry: AdapterRegistry;
  workspaces: WorkspaceResolver;
  handoffLog: HandoffLog;
}

export async function runDispatch(
  state: OrchestratorState,
  deps: DispatchDeps,
): Promise<OrchestratorState> {
  if (!state.plan) {
    return {
      ...state,
      stage: 'aggregate',
      errors: [...state.errors, { stage: 'dispatch', message: 'plan missing' }],
    };
  }

  const cards: HandoffCard[] = [];
  const records: DispatchRecord[] = [];

  for (const task of state.plan.tasks) {
    const role = parseAssignee(task.assignee);
    if (!role) {
      records.push(failedRecord(task.id, `invalid assignee: ${task.assignee}`));
      continue;
    }

    const card = buildHandoffCard(state, task, role);
    cards.push(card);
    await deps.handoffLog.append(card);

    const adapter = deps.registry.resolve(role);
    const cwd = deps.workspaces.resolve(state.chatId);
    const session = await adapter.createSession({
      cwd,
      role,
      agentMeta: { displayName: adapter.displayName, color: '#888' },
      systemPrompt: card.taskBrief,
    });

    const events: AgentEvent[] = [];
    const startedAt = new Date();
    let status: DispatchRecord['status'] = 'completed';

    for await (const event of session.send({ text: card.taskBrief })) {
      events.push(event);
      if (event.type === 'error' && !event.recoverable) {
        status = 'failed';
        break;
      }
    }

    await session.close();

    records.push({
      taskId: task.id,
      handoffCardId: card.id,
      sessionId: session.id,
      status,
      events,
      startedAt,
      finishedAt: new Date(),
    });
  }

  const anyCodeWriting = records.some((r) =>
    r.events.some((e) => e.type === 'file_change'),
  );

  return {
    ...state,
    handoffCards: [...state.handoffCards, ...cards],
    dispatch: [...state.dispatch, ...records],
    stage: anyCodeWriting ? 'review' : 'aggregate',
  };
}

function parseAssignee(assignee: string): AgentRoleId | undefined {
  const stripped = assignee.replace(/^@/, '');
  const valid: AgentRoleId[] = [
    'architect',
    'planner',
    'implementer',
    'reviewer',
    'fixer',
  ];
  return valid.includes(stripped as AgentRoleId)
    ? (stripped as AgentRoleId)
    : undefined;
}

function failedRecord(taskId: string, message: string): DispatchRecord {
  return {
    taskId,
    handoffCardId: '',
    sessionId: '',
    status: 'failed',
    events: [{ type: 'error', message, recoverable: false }],
    startedAt: new Date(),
    finishedAt: new Date(),
  };
}
