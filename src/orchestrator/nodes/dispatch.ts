import type {
  AgentEvent,
  AgentRoleId,
  Artifact,
  ArtifactId,
  ArtifactRef,
  HandoffCard,
  Stage,
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
import type { DispatchRecord, OrchestratorState, PendingGate } from '../state.js';
import { ensureWorkspace } from '../workspace.js';
import type { Db } from '../../db/index.js';
import { loadPinnedForHandoff } from '../../server/pinned-helpers.js';

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
  pinnedDb?: Db;
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
  const artifacts: Artifact[] = [];

  for (const task of state.plan.tasks) {
    const role = parseAssignee(task.assignee);
    if (!role) {
      records.push(failedRecord(task.id, `invalid assignee: ${task.assignee}`));
      continue;
    }

    const baseCard = await generateHandoffCard(
      {
        state,
        task,
        role,
        previousCards: cards,
        ...(deps.pinnedDb
          ? { pinnedMessages: await loadPinnedForHandoff(deps.pinnedDb, state.chatId) }
          : {}),
        ...(role === 'reviewer' || role === 'fixer'
          ? { relevantArtifacts: artifactRefsForReview(state) }
          : {}),
      },
      deps.handoff,
    );
    const card = applyHandoffOverride(
      baseCard,
      findStageForTask(state, task.workflowStageId),
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
            if (event.type === 'artifact') {
              artifacts.push(event.artifact);
            }
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

  const pendingGate = nextPendingGate(state, records);
  const nextStage = pendingGate
    ? 'gate'
    : anyCodeWriting
      ? 'review'
      : 'aggregate';

  return {
    ...state,
    handoffCards: [...state.handoffCards, ...cards],
    dispatch: [...state.dispatch, ...records],
    artifacts: dedupeArtifacts([...state.artifacts, ...artifacts]),
    ...(pendingGate ? { pendingGate } : {}),
    stage: nextStage,
  };
}

function findStageForTask(
  state: OrchestratorState,
  workflowStageId: string | undefined,
): Stage | undefined {
  if (!workflowStageId || !state.workflow) return undefined;
  return state.workflow.stages.find((s) => s.id === workflowStageId);
}

function applyHandoffOverride(card: HandoffCard, stage: Stage | undefined): HandoffCard {
  if (!stage?.handoffOverride) return card;
  const definedOverrides = Object.fromEntries(
    Object.entries(stage.handoffOverride).filter(([, v]) => v !== undefined),
  );
  return {
    ...card,
    ...definedOverrides,
    id: card.id,
    createdAt: card.createdAt,
  } as HandoffCard;
}

function nextPendingGate(
  state: OrchestratorState,
  freshRecords: DispatchRecord[],
): PendingGate | undefined {
  if (!state.workflow) return undefined;
  const dispatchedStageIds = new Set(
    [...state.dispatch, ...freshRecords]
      .map((r) => state.plan?.tasks.find((t) => t.id === r.taskId)?.workflowStageId)
      .filter((v): v is string => typeof v === 'string'),
  );
  for (const stage of state.workflow.stages) {
    if (stage.gate.kind === 'none') continue;
    if (!dispatchedStageIds.has(stage.id)) continue;
    if (state.gateDecisions[stage.id]) continue;
    return { stageId: stage.id, gate: stage.gate };
  }
  return undefined;
}

/**
 * Pick the latest version of each artifact and project to the ArtifactRef
 * shape the HandoffCard carries (closes specs/080 Known gap 3 — reviewer
 * blindness). Reviewer + fixer roles get the canonical artifact list so they
 * can ground feedback in real files instead of a role title.
 */
function artifactRefsForReview(state: OrchestratorState): ArtifactRef[] {
  const latest = new Map<string, Artifact>();
  for (const a of state.artifacts) {
    const prev = latest.get(a.id);
    if (!prev || a.version > prev.version) latest.set(a.id, a);
  }
  return Array.from(latest.values()).map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    ...(a.uri !== undefined ? { uri: a.uri } : {}),
  }));
}

function dedupeArtifacts(artifacts: Artifact[]): Artifact[] {
  const seen = new Set<string>();
  const out: Artifact[] = [];
  for (const a of artifacts) {
    const key = `${a.id}@${a.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
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
