import { Command, isGraphInterrupt, MemorySaver } from '@langchain/langgraph';
import type { AdapterRegistry } from '../adapters/index.js';
import { buildOrchestratorGraph, type GraphDeps } from './graph.js';
import type { HandoffGeneratorOptions } from './handoff.js';
import { type HandoffLog } from './handoff-log.js';
import { type ClarifyGenerator } from './nodes/clarify.js';
import { type WorkspaceResolver } from './nodes/dispatch.js';
import { type IntakeClassifier } from './nodes/intake.js';
import { type Planner } from './nodes/plan.js';
import { type Reviewer } from './nodes/review.js';
import { type SelectSpeakerDeps } from './nodes/select-speaker.js';
import { initialState, type OrchestratorState } from './state.js';
import type { AgentDescription } from '../contracts/index.js';

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
   * Group-chat selector wiring. Defaults to the heuristic selector +
   * in-memory telemetry, suitable for tests; prod plugs in `llmSelector()`
   * + `fileSelectorTelemetry()`.
   */
  selectSpeaker?: SelectSpeakerDeps;
  /**
   * Defaults to an in-memory `MemorySaver` (handy for tests and the smoke
   * script). Pass a `PostgresSaver` from `createPostgresCheckpointer()` in
   * prod so runs survive process restarts (see ADR-001 + issue #40).
   */
  checkpointer?: GraphDeps['checkpointer'];
}

export interface RunOptions {
  chatId: string;
  userMessage: string;
  /** Stable thread id for checkpointing/resume. Defaults to `chatId`. */
  threadId?: string;
  /**
   * Agents in the chat room. When ≥ 2 are provided AND the user message
   * has no `@mention`, the graph starts at the group-chat selector node
   * (spec 050 § (a)) instead of intake. Omit to keep the existing
   * single-chat / PM flow.
   */
  agents?: AgentDescription[];
}

export interface ResumeOptions {
  chatId: string;
  threadId?: string;
  /** Answers keyed by question id, to satisfy a pending clarify interrupt. */
  clarifyAnswers: Record<string, string>;
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
    initialState(opts.chatId, opts.userMessage, {
      ...(opts.agents !== undefined ? { agents: opts.agents } : {}),
    }),
  );
}

export async function resumeOrchestrator(
  opts: ResumeOptions,
  deps: OrchestratorDeps,
): Promise<OrchestratorState> {
  const checkpointer = deps.checkpointer ?? new MemorySaver();
  const graph = buildOrchestratorGraph({ ...deps, checkpointer });
  const threadId = opts.threadId ?? opts.chatId;

  return invoke(graph, threadId, new Command({ resume: opts.clarifyAnswers }));
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
