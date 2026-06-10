import type {
  AgentEvent,
  AgentRoleId,
  AgentSession,
  Artifact,
  ArtifactId,
  AutonomyDecision,
  FailureRecoveryCard,
  HandoffCard,
  PlanTask,
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
import { evaluateAutonomyAction, evaluateRetry, riskForGate } from '../autonomy.js';
import {
  buildHandoffSystemPrompt,
  generateHandoffCard,
  type HandoffGeneratorOptions,
} from '../handoff.js';
import {
  composeHandoffContext,
  loadWorkbenchArtifactsForChat,
} from '../handoff-context.js';
import type { HandoffLog } from '../handoff-log.js';
import type { DispatchRecord, OrchestratorState, PendingGate } from '../state.js';
import { ensureWorkspace } from '../workspace.js';
import type { Db } from '../../db/index.js';

interface GateEvaluation {
  pendingGate?: PendingGate;
  gateDecisions: OrchestratorState['gateDecisions'];
  autonomyDecisions: OrchestratorState['autonomyDecisions'];
}

export interface WorkspaceResolver {
  resolve(chatId: string): string | Promise<string>;
}

/**
 * Hook for user-initiated interrupts (spec 010 monitoring rules). The host
 * registers live sessions so a stop request can reach them, and dispatch
 * checks isInterrupted() to avoid starting new work after a stop.
 */
export interface DispatchControlHooks {
  trackSession(session: AgentSession): void;
  untrackSession(session: AgentSession): void;
  isInterrupted(): boolean;
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
  control?: DispatchControlHooks;
}

interface PreparedDispatchTask {
  task: PlanTask;
  role: AgentRoleId;
  card: HandoffCard;
}

interface TaskRunResult {
  record: DispatchRecord;
  artifacts: Artifact[];
  cards: HandoffCard[];
  autonomyDecisions: AutonomyDecision[];
  recoveryCard?: FailureRecoveryCard;
}

interface AttemptResult {
  sessionId: string;
  status: DispatchRecord['status'];
  events: AgentEvent[];
  artifacts: Artifact[];
  cards: HandoffCard[];
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
  const autonomyDecisions: AutonomyDecision[] = [];
  const recoveryCards: FailureRecoveryCard[] = [];
  const persistedArtifacts = deps.artifactDb
    ? await loadWorkbenchArtifactsForChat(deps.artifactDb, state.chatId)
    : [];
  const contextState: OrchestratorState = {
    ...state,
    artifacts: dedupeArtifacts([...persistedArtifacts, ...state.artifacts]),
  };

  const completedTaskIds = new Set(
    state.dispatch
      .filter((r) => r.status === 'completed')
      .map((r) => r.taskId),
  );
  const failedTaskIds = new Set(
    state.dispatch
      .filter((r) => r.status === 'failed')
      .map((r) => r.taskId),
  );
  const remaining = new Map(state.plan.tasks.map((task) => [task.id, task]));

  while (remaining.size > 0) {
    // Spec 010: after a user stop, summarize what already ran but never start
    // a new wave. Tasks left in `remaining` simply have no dispatch record.
    if (deps.control?.isInterrupted()) break;

    const batch = state.plan.tasks.filter(
      (task) =>
        remaining.has(task.id) &&
        task.deps.every((dep) => completedTaskIds.has(dep)),
    );

    if (batch.length === 0) {
      for (const task of state.plan.tasks.filter((t) => remaining.has(t.id))) {
        const unmet = task.deps.filter((dep) => !completedTaskIds.has(dep));
        const failed = unmet.filter((dep) => failedTaskIds.has(dep));
        const message =
          failed.length > 0
            ? `dependency failed: ${failed.join(', ')}`
            : `unmet dependencies: ${unmet.join(', ') || 'none'}`;
        records.push(
          failedRecord(task.id, message),
        );
        recoveryCards.push(
          buildFailureRecoveryCard({
            task,
            agentId: task.assignee.replace(/^@/, ''),
            events: [{ type: 'error', message, recoverable: false }],
            attemptsUsed: 1,
            policyRetryBudget: state.autonomyPolicy.retryBudget,
          }),
        );
        remaining.delete(task.id);
        failedTaskIds.add(task.id);
      }
      break;
    }

    const prepared: PreparedDispatchTask[] = [];
    for (const task of batch) {
      remaining.delete(task.id);
      const result = await prepareDispatchTask(task, state, contextState, cards, deps);
      if ('record' in result) {
        records.push(result.record);
        recoveryCards.push(
          buildFailureRecoveryCard({
            task,
            agentId: task.assignee.replace(/^@/, ''),
            events: result.record.events,
            attemptsUsed: 1,
            policyRetryBudget: state.autonomyPolicy.retryBudget,
          }),
        );
        failedTaskIds.add(task.id);
        continue;
      }
      prepared.push(result);
      cards.push(result.card);
      await deps.handoffLog.append(result.card);
    }

    const batchResults = await Promise.all(
      prepared.map((task) => runPreparedTask(task, state, deps)),
    );
    for (const result of batchResults) {
      records.push(result.record);
      artifacts.push(...result.artifacts);
      cards.push(...result.cards);
      autonomyDecisions.push(...result.autonomyDecisions);
      if (result.recoveryCard) recoveryCards.push(result.recoveryCard);
      if (result.record.status === 'completed') {
        completedTaskIds.add(result.record.taskId);
      } else {
        failedTaskIds.add(result.record.taskId);
      }
    }
  }

  const anyCodeWriting = records.some((r) =>
    r.events.some((e) => e.type === 'file_change'),
  );

  const gateEvaluation = nextPendingGate(
    {
      ...state,
      autonomyDecisions: [...state.autonomyDecisions, ...autonomyDecisions],
    },
    records,
  );
  const nextStage = gateEvaluation.pendingGate
    ? 'gate'
    : recoveryCards.length > 0
      ? 'recovery'
      : anyCodeWriting
      ? 'review'
      : 'aggregate';
  const pendingRecovery = recoveryCards.at(-1) ?? state.pendingRecovery;

  return {
    ...state,
    handoffCards: [...state.handoffCards, ...cards],
    dispatch: [...state.dispatch, ...records],
    artifacts: dedupeArtifacts([...contextState.artifacts, ...artifacts]),
    gateDecisions: gateEvaluation.gateDecisions,
    autonomyDecisions: gateEvaluation.autonomyDecisions,
    ...(gateEvaluation.pendingGate ? { pendingGate: gateEvaluation.pendingGate } : {}),
    failureRecoveryCards: [...state.failureRecoveryCards, ...recoveryCards],
    ...(pendingRecovery ? { pendingRecovery } : {}),
    stage: nextStage,
  };
}

async function prepareDispatchTask(
  task: PlanTask,
  state: OrchestratorState,
  contextState: OrchestratorState,
  previousCards: HandoffCard[],
  deps: DispatchDeps,
): Promise<PreparedDispatchTask | { record: DispatchRecord }> {
  const role = parseAssignee(task.assignee);
  if (!role) {
    return { record: failedRecord(task.id, `invalid assignee: ${task.assignee}`) };
  }

  const baseCard = await generateHandoffCard(
    {
      state: contextState,
      task,
      role,
      previousCards,
      ...(await composeHandoffContext({
        state: contextState,
        task,
        role,
        previousCards,
        ...(deps.pinnedDb ? { db: deps.pinnedDb } : {}),
      })),
    },
    deps.handoff,
  );
  return {
    task,
    role,
    card: applyHandoffOverride(
      baseCard,
      findStageForTask(state, task.workflowStageId),
    ),
  };
}

async function runPreparedTask(
  prepared: PreparedDispatchTask,
  state: OrchestratorState,
  deps: DispatchDeps,
): Promise<TaskRunResult> {
  const { task, role, card } = prepared;
  const startedAt = new Date();
  const attempts: AttemptResult[] = [];
  const autonomyDecisions: AutonomyDecision[] = [];

  try {
    const cwd = await deps.workspaces.resolve(state.chatId);
    await ensureWorkspace(cwd);

    const adapter = deps.registry.resolve(role);
    let latest = await runTaskAttempt({
      adapter,
      role,
      task,
      card,
      cwd,
      state,
      deps,
    });
    attempts.push(latest);

    while (latest.status === 'failed') {
      // A user stop is not an agent failure — never auto-retry past it.
      if (deps.control?.isInterrupted()) break;
      const failedEvent = lastErrorEvent(latest.events);
      const retryDecision = evaluateRetry({
        policy: state.autonomyPolicy,
        usedRetries: attempts.length - 1,
        risk: failedEvent?.recoverable ? 'low' : 'medium',
        reason: `Task ${task.id} failed for @${role}.`,
      });
      autonomyDecisions.push(retryDecision);
      if (retryDecision.decision !== 'auto_approved') break;

      latest = await runTaskAttempt({
        adapter,
        role,
        task,
        card,
        cwd,
        state,
        deps,
      });
      attempts.push(latest);
    }

    const events = attempts.flatMap((attempt) => attempt.events);
    const artifacts = attempts.flatMap((attempt) => attempt.artifacts);
    const cards = attempts.flatMap((attempt) => attempt.cards);
    const recoveryCard =
      latest.status === 'failed'
        ? buildFailureRecoveryCard({
            task,
            agentId: role,
            events,
            attemptsUsed: attempts.length,
            policyRetryBudget: state.autonomyPolicy.retryBudget,
            ...(autonomyDecisions.length > 0
              ? { autonomyDecision: autonomyDecisions[autonomyDecisions.length - 1] }
              : {}),
          })
        : undefined;
    return {
      record: {
        taskId: task.id,
        handoffCardId: card.id,
        sessionId: attempts.map((attempt) => attempt.sessionId).join(','),
        status: latest.status,
        events,
        startedAt,
        finishedAt: new Date(),
      },
      artifacts,
      cards,
      autonomyDecisions,
      ...(recoveryCard ? { recoveryCard } : {}),
    };
  } catch (error) {
    const message = errorMessage(error);
    const recoveryCard = buildFailureRecoveryCard({
      task,
      agentId: role,
      events: [{ type: 'error', message, recoverable: false }],
      attemptsUsed: attempts.length || 1,
      policyRetryBudget: state.autonomyPolicy.retryBudget,
    });
    return {
      record: failedRecord(task.id, message, {
        handoffCardId: card.id,
        startedAt,
      }),
      artifacts: attempts.flatMap((attempt) => attempt.artifacts),
      cards: attempts.flatMap((attempt) => attempt.cards),
      autonomyDecisions,
      recoveryCard,
    };
  }
}

async function runTaskAttempt(input: {
  adapter: ReturnType<AdapterRegistry['resolve']>;
  role: AgentRoleId;
  task: PlanTask;
  card: HandoffCard;
  cwd: string;
  state: OrchestratorState;
  deps: DispatchDeps;
}): Promise<AttemptResult> {
  const { adapter, role, task, card, cwd, state, deps } = input;
  const allowedTools = allowedToolsForTask(state, role, task);
  const session = await adapter.createSession({
    cwd,
    role,
    agentMeta: { displayName: adapter.displayName, color: '#888' },
    systemPrompt: buildHandoffSystemPrompt(card),
    ...(allowedTools ? { allowedTools } : {}),
  });
  deps.control?.trackSession(session);
  const events: AgentEvent[] = [];
  const artifacts: Artifact[] = [];
  const cards: HandoffCard[] = [];
  let status: DispatchRecord['status'] = 'completed';
  let sawRecoverableError = false;
  let sawDone = false;
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
    for await (const rawEvent of session.send({ text: buildAgentInputText(card) })) {
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
        if (event.type === 'error') {
          if (event.recoverable) {
            sawRecoverableError = true;
          } else {
            status = 'failed';
            break;
          }
        }
        if (event.type === 'done') {
          sawDone = true;
        }
      }
      if (status === 'failed') break;
    }
  } finally {
    deps.control?.untrackSession(session);
    await session.close();
  }
  if (status === 'completed' && sawRecoverableError && !sawDone) {
    status = 'failed';
  }

  return {
    sessionId: session.id,
    status,
    events,
    artifacts,
    cards,
  };
}

function buildAgentInputText(card: HandoffCard): string {
  const lines: string[] = [card.taskBrief.trim()];

  const userIntent = card.userIntent.trim();
  if (userIntent && userIntent !== card.taskBrief.trim()) {
    lines.push('', 'User intent:', userIntent);
  }

  if (card.relevantArtifacts.length > 0) {
    lines.push(
      '',
      'Relevant artifacts:',
      ...card.relevantArtifacts.map((artifact) =>
        `- ${artifact.title} (${artifact.kind}, ${artifact.id})${artifact.uri ? ` ${artifact.uri}` : ''}`,
      ),
    );
  }

  lines.push('', `Full history ref: ${card.fullHistoryRef}`);
  return lines.join('\n');
}

function findStageForTask(
  state: OrchestratorState,
  workflowStageId: string | undefined,
): Stage | undefined {
  if (!workflowStageId || !state.workflow) return undefined;
  return state.workflow.stages.find((s) => s.id === workflowStageId);
}

function allowedToolsForTask(
  state: OrchestratorState,
  role: AgentRoleId,
  task: PlanTask,
): string[] | undefined {
  const stage = findStageForTask(state, task.workflowStageId);
  if (!stage) return undefined;

  const seatIndex = task.id.startsWith(`${stage.id}__`)
    ? Number(task.id.slice(stage.id.length + 2))
    : NaN;
  const indexedSeat = Number.isInteger(seatIndex) ? stage.seats[seatIndex] : undefined;
  if (indexedSeat?.ref.kind === 'role' && indexedSeat.ref.role === role) {
    return nonEmptyTools(indexedSeat.tools);
  }

  const seat = stage.seats.find((s) => s.ref.kind === 'role' && s.ref.role === role);
  return nonEmptyTools(seat?.tools);
}

function nonEmptyTools(tools: string[] | undefined): string[] | undefined {
  return tools && tools.length > 0 ? tools : undefined;
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
): GateEvaluation {
  const gateDecisions = { ...state.gateDecisions };
  const autonomyDecisions = [...state.autonomyDecisions];
  if (!state.workflow) return { gateDecisions, autonomyDecisions };
  const dispatchedStageIds = new Set(
    [...state.dispatch, ...freshRecords]
      .map((r) => state.plan?.tasks.find((t) => t.id === r.taskId)?.workflowStageId)
      .filter((v): v is string => typeof v === 'string'),
  );
  for (const stage of state.workflow.stages) {
    if (stage.gate.kind === 'none') continue;
    if (!dispatchedStageIds.has(stage.id)) continue;
    if (gateDecisions[stage.id]) continue;
    const risk = riskForGate(stage, stage.gate);
    const decision = evaluateAutonomyAction({
      policy: state.autonomyPolicy,
      action: 'approve_gate',
      risk,
      reason: `Gate ${stage.id} (${stage.gate.kind}) completed.`,
    });
    autonomyDecisions.push(decision);
    if (decision.decision === 'auto_approved') {
      gateDecisions[stage.id] = 'approve';
      continue;
    }
    return {
      pendingGate: { stageId: stage.id, gate: stage.gate },
      gateDecisions,
      autonomyDecisions,
    };
  }
  return { gateDecisions, autonomyDecisions };
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

function buildFailureRecoveryCard(input: {
  task: PlanTask;
  agentId: string;
  events: AgentEvent[];
  attemptsUsed: number;
  policyRetryBudget: number;
  autonomyDecision?: AutonomyDecision;
}): FailureRecoveryCard {
  const lastError = lastErrorEvent(input.events);
  const message = lastError?.message ?? 'Agent run failed.';
  return {
    id: `failure:${input.task.id}`,
    taskId: input.task.id,
    taskTitle: input.task.title,
    agentId: input.agentId,
    summary: summarizeFailure(message),
    debugDetails: message,
    attemptsUsed: input.attemptsUsed,
    retryBudget: input.policyRetryBudget,
    actions: ['retry', 'reassign', 'edit_handoff', 'stop'],
    ...(input.autonomyDecision ? { autonomyDecision: input.autonomyDecision } : {}),
    createdAt: new Date(),
  };
}

function lastErrorEvent(events: AgentEvent[]): Extract<AgentEvent, { type: 'error' }> | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === 'error') return event;
  }
  return undefined;
}

function summarizeFailure(message: string): string {
  const firstLine = message.split('\n').find((line) => line.trim().length > 0);
  const cleaned = firstLine?.replace(/\s+at\s+.+$/, '').trim() || 'Agent run failed.';
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}
