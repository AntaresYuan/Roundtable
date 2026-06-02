import { generateObject, type LanguageModel } from 'ai';
import { SelectorDecisionSchema, type SelectorDecision } from '../../contracts/index.js';
import {
  heuristicSelector,
  type SelectorInput,
  type SpeakerSelector,
} from '../nodes/selector.js';
import { defaultOrchestratorModel } from './provider.js';

export interface LlmSelectorOpts {
  model?: LanguageModel;
  /** Falls back to the heuristic when the LLM call throws or returns junk. */
  fallback?: SpeakerSelector;
}

const SYSTEM_PROMPT = `You are the Roundtable PM's speaker selector. Given the \
last user message and the agents in the room, pick who should reply.

Rules:
- chosenAgentId must be one of the supplied agent ids, or null if no agent fits.
- confidence in [0,1]: 1.0 means the message is unambiguously for one agent; \
  0.5 means two or more agents are plausible.
- runnersUp: 0-3 plausible alternates with their own confidences, descending.
- reasoning: <=200 chars, plain language; cite the keyword or context that drove \
  the pick (no chain-of-thought).
- Never invent agent ids that were not in the input.
- Prefer the agent whose description or capabilities most overlap the request.`;

export function llmSelector(opts: LlmSelectorOpts = {}): SpeakerSelector {
  const model = opts.model ?? defaultOrchestratorModel();
  const fallback = opts.fallback ?? heuristicSelector();

  return {
    async select(input: SelectorInput): Promise<SelectorDecision> {
      if (input.agents.length === 0) {
        return fallback.select(input);
      }
      try {
        const { object } = await generateObject({
          model,
          schema: SelectorDecisionSchema,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(input),
        });
        // Defensive: the LLM may hallucinate an id outside the supplied set.
        const validIds = new Set(input.agents.map((a) => a.id));
        if (object.chosenAgentId && !validIds.has(object.chosenAgentId)) {
          return fallback.select(input);
        }
        return object;
      } catch {
        return fallback.select(input);
      }
    },
  };
}

function buildPrompt(input: SelectorInput): string {
  const roster = input.agents
    .map(
      (a) =>
        `- id="${a.id}" name="${a.displayName}" role=${a.role} caps=[${a.capabilities.join(',')}] desc="${a.description}"`,
    )
    .join('\n');

  const history =
    input.recentMessages && input.recentMessages.length > 0
      ? `\nRecent turns (oldest first):\n${input.recentMessages
          .map((m) => `- ${m.authorId}: ${m.text}`)
          .join('\n')}`
      : '';

  return [
    `User message:\n"""\n${input.userMessage}\n"""`,
    `Agents in the room:\n${roster}`,
    history,
    `Pick the next speaker per the rules.`,
  ].join('\n\n');
}
