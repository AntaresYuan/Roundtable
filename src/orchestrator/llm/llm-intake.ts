import { generateObject, type LanguageModel } from 'ai';
import { IntakeResultSchema, type IntakeResult } from '../../contracts/index.js';
import type { IntakeClassifier } from '../nodes/intake.js';
import { heuristicIntake } from '../nodes/intake.js';
import { defaultOrchestratorModel } from './provider.js';

export interface LlmIntakeOpts {
  model?: LanguageModel;
  fallback?: IntakeClassifier;
}

const SYSTEM_PROMPT = `You are the Roundtable PM. Classify a user's incoming \
chat message so the orchestrator can decide whether to plan, clarify, dispatch, \
or escalate to review.

Rules:
- intentType: 'build' for new features, 'modify' for changes to existing code, \
  'debug' for failures, 'inspect' for read-only questions, 'review' for code \
  review, 'control' for stop/cancel commands.
- clarity: 'ambiguous' if the request is too vague to plan without follow-up, \
  else 'clear'. Set ambiguityScore in [0,1].
- complexity: 'multi_agent' if the work spans planning, implementing and \
  reviewing; 'single_agent' for narrow tasks.
- risk: 'high' for production deploys, secrets, payments, database \
  migrations; 'medium' for auth/database/CI; 'low' otherwise.
- suggestedRoles: pick from architect, planner, implementer, reviewer, fixer.
- userVisibleSummary: <=180 chars, plain language.

Never invent details the user did not state.`;

export function llmIntake(opts: LlmIntakeOpts = {}): IntakeClassifier {
  const model = opts.model ?? defaultOrchestratorModel();
  const fallback = opts.fallback ?? heuristicIntake();

  return {
    async classify(message: string): Promise<IntakeResult> {
      try {
        const { object } = await generateObject({
          model,
          schema: IntakeResultSchema,
          system: SYSTEM_PROMPT,
          prompt: `User message:\n"""\n${message}\n"""`,
        });
        return object;
      } catch (err) {
        // Falling back to the heuristic is safer than failing the whole turn
        // — the heuristic always returns *something* and the worst case is a
        // clarify prompt the user can answer.
        return fallback.classify(message);
      }
    },
  };
}
