import { Command, isGraphInterrupt, MemorySaver } from '@langchain/langgraph';
import type { AdapterRegistry } from '../adapters/index.js';
import type { Workflow } from '../contracts/index.js';
import { buildOrchestratorGraph, type GraphDeps } from './graph.js';
import type { ArtifactWatcherContext } from './artifact-watcher.js';
import type { HandoffGeneratorOptions } from './handoff.js';
import { type HandoffLog } from './handoff-log.js';
import { type ClarifyGenerator } from './nodes/clarify.js';
import { type WorkspaceResolver } from './nodes/dispatch.js';
import { type IntakeClassifier } from './nodes/intake.js';
import { type Planner } from './nodes/plan.js';
import { type Reviewer } from './nodes/review.js';
import { initialState, type GateDecision, type OrchestratorState } from './state.js';

export interface OrchestratorDeps {
  registry: AdapterRegistry;
  workspaces: WorkspaceResolver;
  intake?: IntakeClassifier;
  clarify?: ClarifyGenerator;
  planner?: Planner;
  reviewer?: Reviewer;
  handoffLog?: HandoffLog;
  handoff?: HandoffGeneratorOptions;
  /**
   * Defaults to an in-memory `MemorySaver` (handy for tests and the smoke
   * script). Pass a `PostgresSaver` from `createPostgresCheckpointer()` in
   * prod so runs survive process restarts (see ADR-001 + issue #40).
   */
  checkpointer?: GraphDeps['checkpointer'];
  /** Enables file_change → artifact persistence and dependency broadcasts. */
  artifactDb?: ArtifactWatcherContext['db'];
}

export interface RunOptions {
  chatId: string;
  userMessage: string;
  /** Stable thread id for checkpointing/resume. Defaults to `chatId`. */
  threadId?: string;
  /** Drives the run via a customizable Workflow spec (specs/090). */
  workflow?: Workflow;
}

export interface GateResolveResume {
  stageId: string;
  decision: GateDecision;
}

export interface ResumeOptions {
  chatId: string;
  threadId?: string;
  /** Answers keyed by question id, to satisfy a pending clarify interrupt. */
  clarifyAnswers?: Record<string, string>;
  /** Decision payload to resolve a pending workflow gate. */
  gate?: GateResolveResume;
}

export async function runOrchestrator(
  opts: RunOptions,
  deps: OrchestratorDeps,
): Promise<OrchestratorState> {
  const checkpointer = deps.checkpointer ?? new MemorySaver();
  const graph = buildOrchestratorGraph({ ...deps, checkpointer });
  const threadId = opts.threadId ?? opts.chatId;

  return invoke(
    graph,
    threadId,
    initialState(opts.chatId, opts.userMessage, opts.workflow),
  );
}

export async function resumeOrchestrator(
  opts: ResumeOptions,
  deps: OrchestratorDeps,
): Promise<OrchestratorState> {
  const checkpointer = deps.checkpointer ?? new MemorySaver();
  const graph = buildOrchestratorGraph({ ...deps, checkpointer });
  const threadId = opts.threadId ?? opts.chatId;

  const resumePayload: GateResolveResume | Record<string, string> =
    opts.gate ?? opts.clarifyAnswers ?? {};
  return invoke(graph, threadId, new Command({ resume: resumePayload }));
}

async function invoke(
  graph: ReturnType<typeof buildOrchestratorGraph>,
  threadId: string,
  input: OrchestratorState | Command,
): Promise<OrchestratorState> {
  try {
    const result = await graph.invoke(input as never, {
      configurable: { thread_id: threadId },
    });
    return result as unknown as OrchestratorState;
  } catch (err) {
    if (isGraphInterrupt(err)) {
      const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
      return snapshot.values as unknown as OrchestratorState;
    }
    throw err;
  }
}
