import type {
  AgentEvent,
  AgentRoleId,
  HandoffCard,
  PinnedMessage,
} from '../../contracts/index.js';
import type { AdapterRegistry } from '../../adapters/index.js';
import {
  buildHandoffSystemPrompt,
  generateHandoffCard,
  type HandoffGeneratorOptions,
} from '../handoff.js';
import type { HandoffLog } from '../handoff-log.js';
import type { DispatchRecord, OrchestratorState } from '../state.js';
import { ensureWorkspace } from '../workspace.js';

export interface WorkspaceResolver {
  resolve(chatId: string): string;
}

/**
 * Loads the chat's pinned messages so the HandoffCard generator can flow
 * them into `card.pinnedMessages`. Wired in prod with
 * `loadPinnedForHandoff(db, chatId)` from `src/server/pinned-helpers.ts`;
 * tests pass an in-memory function or omit (defaults to `[]`).
 */
export type PinnedLoader = (chatId: string) => Promise<PinnedMessage[]>;

export interface DispatchDeps {
  registry: AdapterRegistry;
  workspaces: WorkspaceResolver;
  handoffLog: HandoffLog;
  handoff?: HandoffGeneratorOptions;
  pinnedLoader?: PinnedLoader;
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

  // Load pinned messages once per dispatch turn; same set flows into every
  // card emitted this turn (spec 030 § Token-control § 4: pinned messages
  // are global constraints, not per-task).
  const pinnedMessages = deps.pinnedLoader
    ? await deps.pinnedLoader(state.chatId)
    : [];

  for (const task of state.plan.tasks) {
    const role = parseAssignee(task.assignee);
    if (!role) {
      records.push(failedRecord(task.id, `invalid assignee: ${task.assignee}`));
      continue;
    }

    const card = await generateHandoffCard(
      {
        state,
        task,
        role,
        previousCards: cards,
        pinnedMessages,
      },
      deps.handoff,
    );
    cards.push(card);
    await deps.handoffLog.append(card);

    const cwd = deps.workspaces.resolve(state.chatId);
    const startedAt = new Date();

    try {
      await ensureWorkspace(cwd);

      const adapter = deps.registry.resolve(role);
      const session = await adapter.createSession({
        cwd,
        role,
        agentMeta: { displayName: adapter.displayName, color: '#888' },
        systemPrompt: buildHandoffSystemPrompt(card),
      });

      const events: AgentEvent[] = [];
      let status: DispatchRecord['status'] = 'completed';

      try {
        for await (const event of session.send({ text: card.taskBrief })) {
          events.push(event);
          if (event.type === 'error' && !event.recoverable) {
            status = 'failed';
            break;
          }
        }
      } finally {
        await session.close();
      }

      records.push({
        taskId: task.id,
        handoffCardId: card.id,
        sessionId: session.id,
        status,
        events,
        startedAt,
        finishedAt: new Date(),
      });
    } catch (error) {
      records.push(
        failedRecord(task.id, errorMessage(error), {
          handoffCardId: card.id,
          startedAt,
        }),
      );
    }
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

function failedRecord(
  taskId: string,
  message: string,
  opts: { handoffCardId?: string; startedAt?: Date } = {},
): DispatchRecord {
  return {
    taskId,
    handoffCardId: opts.handoffCardId ?? '',
    sessionId: '',
    status: 'failed',
    events: [{ type: 'error', message, recoverable: false }],
    startedAt: opts.startedAt ?? new Date(),
    finishedAt: new Date(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'dispatch failed';
}
