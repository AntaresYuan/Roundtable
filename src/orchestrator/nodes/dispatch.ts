import type {
  AgentEvent,
  AgentRoleId,
  Artifact,
  ArtifactId,
  HandoffCard,
} from '../../contracts/index.js';
import type { AdapterRegistry } from '../../adapters/index.js';
import {
  buildDepChangedMessage,
  buildSyncHandoffCard,
} from '../dependency-broadcast.js';
import type { DependencyGraph } from '../dependency-graph.js';
import {
  persistDependency,
  type DependencyStore,
} from '../dependency-store.js';
import { ArtifactWatcher, type ArtifactWatcherContext } from '../artifact-watcher.js';
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

export interface DispatchDeps {
  registry: AdapterRegistry;
  workspaces: WorkspaceResolver;
  handoffLog: HandoffLog;
  handoff?: HandoffGeneratorOptions;
  dependencyGraph?: DependencyGraph;
  dependencyStore?: DependencyStore;
  artifactDb?: ArtifactWatcherContext['db'];
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

    const card = await generateHandoffCard(
      {
        state,
        task,
        role,
        previousCards: cards,
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
      const artifactWatcher = deps.artifactDb && deps.dependencyGraph
        ? new ArtifactWatcher({
            db: deps.artifactDb,
            chatId: state.chatId,
            ownerAgentId: role,
            dependencyGraph: deps.dependencyGraph,
            ...(deps.dependencyStore ? { dependencyStore: deps.dependencyStore } : {}),
          })
        : undefined;

      try {
        for await (const rawEvent of session.send({ text: card.taskBrief })) {
          const observedEvents = artifactWatcher
            ? await artifactWatcher.accept(rawEvent)
            : [rawEvent];
          for (const event of observedEvents) {
            events.push(event);
            if (!artifactWatcher) {
              const dependencyEvents = await handleDependencyEvent(event, {
                chatId: state.chatId,
                handoffLog: deps.handoffLog,
                ...(deps.dependencyGraph ? { graph: deps.dependencyGraph } : {}),
                ...(deps.dependencyStore ? { store: deps.dependencyStore } : {}),
              });
              events.push(...dependencyEvents.events);
              cards.push(...dependencyEvents.cards);
            }
            if (event.type === 'error' && !event.recoverable) {
              status = 'failed';
              break;
            }
          }
          if (status === 'failed') break;
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

async function handleDependencyEvent(
  event: AgentEvent,
  deps: {
    chatId: string;
    graph?: DependencyGraph;
    store?: DependencyStore;
    handoffLog: HandoffLog;
  },
): Promise<{ events: AgentEvent[]; cards: HandoffCard[] }> {
  if (!deps.graph) return { events: [], cards: [] };

  try {
    if (event.type === 'declare_dependency') {
      const row = {
        fromArtifactId: event.from as ArtifactId,
        toArtifactId: event.to as ArtifactId,
        kind: event.kind,
      };
      if (deps.store) {
        await persistDependency(deps.graph, deps.store, row);
      } else {
        deps.graph.addDependency(row.fromArtifactId, row.toArtifactId, row.kind);
      }
      return { events: [], cards: [] };
    }

    if (event.type !== 'artifact') return { events: [], cards: [] };

    const notices = deps.graph.onArtifactObserved(event.artifact);
    const cards = notices.map((notice) =>
      buildSyncHandoffCard({
        notice,
        changeSummary: summarizeArtifactChange(event.artifact),
        fullHistoryRef: `chat:${deps.chatId}`,
      }),
    );
    for (const card of cards) {
      await deps.handoffLog.append(card);
    }
    return {
      events: notices.map((notice) => ({
        type: 'text_delta',
        delta: buildDepChangedMessage(notice),
      })),
      cards,
    };
  } catch (error) {
    return {
      events: [
        {
          type: 'error',
          message: `dependency graph update failed: ${errorMessage(error)}`,
          recoverable: true,
        },
      ],
      cards: [],
    };
  }
}

function summarizeArtifactChange(artifact: Artifact): string {
  return `${artifact.title} changed to v${artifact.version}.`;
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
