import type {
  AgentDescription,
  ChatId,
  SelectorDecision,
} from '../../contracts/index.js';
import { inMemorySelectorTelemetry, type SelectorTelemetry } from '../selector-log.js';
import type { ClarifyQuestion } from '../state.js';

/** Default confidence below which the selector clarifies in a ≥4-agent room. */
export const DEFAULT_SELECTOR_CONFIDENCE_THRESHOLD = 0.6;

/** Spec 050 § (a): the clarify guard kicks in only when the room is large. */
export const SELECTOR_CLARIFY_MIN_AGENTS = 4;

export interface SpeakerSelector {
  select(input: SelectorInput): Promise<SelectorDecision>;
}

export interface SelectorInput {
  userMessage: string;
  agents: AgentDescription[];
  /** Optional recent turn history to disambiguate references like "it" / "that". */
  recentMessages?: ReadonlyArray<{ authorId: string; text: string }>;
}

export interface RunSelectorOpts {
  chatId: ChatId;
  selector?: SpeakerSelector;
  telemetry?: SelectorTelemetry;
  /** Override the default 0.6 confidence cutoff for the clarify fallback. */
  confidenceThreshold?: number;
  now?: () => Date;
}

export interface RunSelectorResult {
  decision: SelectorDecision;
  /** Set when the clarify guard fired — caller surfaces it as a ClarifyState. */
  clarifyQuestion: ClarifyQuestion | null;
  fallbackTriggered: boolean;
}

/**
 * LangGraph-style node body for the group-chat selector. Picks the next
 * speaker, writes telemetry, and surfaces a clarify question when the room
 * is large and the LLM's confidence is too low to trust silently.
 *
 * Wiring into the orchestrator graph (which channels this through state) is
 * deliberately left out — it ships when the group-chat router is built (see
 * `specs/050-group-chat.md`). The function returns a `RunSelectorResult` so a
 * future graph node can map it into `OrchestratorState`.
 */
export async function runSelector(
  input: SelectorInput,
  opts: RunSelectorOpts,
): Promise<RunSelectorResult> {
  const selector = opts.selector ?? heuristicSelector();
  const threshold = opts.confidenceThreshold ?? DEFAULT_SELECTOR_CONFIDENCE_THRESHOLD;
  const telemetry = opts.telemetry ?? inMemorySelectorTelemetry();
  const now = opts.now ?? (() => new Date());

  const decision = await selector.select(input);

  const fallbackTriggered =
    decision.chosenAgentId !== null &&
    decision.confidence < threshold &&
    input.agents.length >= SELECTOR_CLARIFY_MIN_AGENTS;

  let clarifyQuestion: ClarifyQuestion | null = null;
  if (fallbackTriggered) {
    clarifyQuestion = buildAmbiguousSpeakerClarify(decision, input.agents);
  }

  await telemetry.record({
    ts: now().toISOString(),
    chatId: opts.chatId,
    userMessage: input.userMessage,
    agentCount: input.agents.length,
    decision,
    fallbackTriggered,
  });

  return { decision, clarifyQuestion, fallbackTriggered };
}

/**
 * Build the "Did you mean @A or @B?" clarify card.
 *
 * Pulls the chosen agent + top runner-up so the user picks between the two
 * candidates the selector itself was torn between, instead of seeing the
 * full roster (which would defeat the purpose of the selector).
 */
function buildAmbiguousSpeakerClarify(
  decision: SelectorDecision,
  agents: AgentDescription[],
): ClarifyQuestion {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const chosen = decision.chosenAgentId ? byId.get(decision.chosenAgentId) : undefined;
  const runnerUp = decision.runnersUp
    .map((r) => byId.get(r.agentId))
    .find((a): a is AgentDescription => Boolean(a) && a?.id !== decision.chosenAgentId);

  const options: ClarifyQuestion['options'] = [];
  if (chosen) options.push({ id: chosen.id, label: `@${chosen.displayName}` });
  if (runnerUp) options.push({ id: runnerUp.id, label: `@${runnerUp.displayName}` });
  // If the runner-up was missing or duplicated, fall back to the next agent
  // alphabetically so the user always has at least two choices.
  if (options.length < 2) {
    const fillers = agents
      .filter((a) => !options.some((o) => o.id === a.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 2 - options.length)
      .map((a) => ({ id: a.id, label: `@${a.displayName}` }));
    options.push(...fillers);
  }

  return {
    id: 'selector_speaker',
    prompt: 'Which agent should pick this up?',
    options,
  };
}

/**
 * Zero-LLM fallback so the selector is callable in tests and offline runs.
 *
 * Scores each agent by overlap between user-message tokens and the agent's
 * description + capability tags. Returns a low-confidence pick when scores
 * are tied (so the clarify guard fires for ≥4-agent rooms), and the highest
 * score with normalized confidence otherwise.
 */
export function heuristicSelector(): SpeakerSelector {
  return {
    async select({ userMessage, agents }): Promise<SelectorDecision> {
      if (agents.length === 0) {
        return {
          chosenAgentId: null,
          confidence: 0,
          reasoning: 'No agents in the room.',
          runnersUp: [],
        };
      }

      const tokens = tokenize(userMessage);
      const scored = agents
        .map((agent) => ({ agent, score: scoreAgent(tokens, agent) }))
        .sort((a, b) => b.score - a.score);

      const top = scored[0]!;
      const second = scored[1];
      const margin = top.score - (second?.score ?? 0);

      // No keyword matched anyone: low confidence, just pick the first agent.
      if (top.score === 0) {
        return {
          chosenAgentId: top.agent.id,
          confidence: 0.2,
          reasoning: 'No keyword match; defaulting to first agent.',
          runnersUp: scored.slice(1, 3).map(({ agent }) => ({
            agentId: agent.id,
            confidence: 0.1,
          })),
        };
      }

      // Confidence: ratio of top score to (top + runner-up), clipped to [0.3, 0.95].
      const denom = top.score + (second?.score ?? 0);
      const raw = denom === 0 ? 0.5 : top.score / denom;
      const confidence = clamp(raw, 0.3, 0.95);

      return {
        chosenAgentId: top.agent.id,
        confidence,
        reasoning:
          margin === 0
            ? `Tied keyword match with ${second?.agent.displayName ?? 'others'}; picking ${top.agent.displayName}.`
            : `${top.agent.displayName} best matches keywords in the user message.`,
        runnersUp: scored.slice(1, 3).map(({ agent, score }) => ({
          agentId: agent.id,
          confidence: denom === 0 ? 0 : clamp(score / denom, 0, 0.95),
        })),
      };
    },
  };
}

function scoreAgent(tokens: Set<string>, agent: AgentDescription): number {
  let score = 0;
  for (const cap of agent.capabilities) {
    if (tokens.has(cap.toLowerCase())) score += 2;
  }
  for (const word of tokenize(agent.description)) {
    if (tokens.has(word)) score += 1;
  }
  // Tiny boost for role-name match in the message.
  if (tokens.has(agent.role)) score += 1;
  return score;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 2),
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Re-export for callers that want to assert the agent id type without
 * importing from the contracts module directly.
 */
export type { AgentDescription, AgentId, SelectorDecision } from '../../contracts/index.js';
