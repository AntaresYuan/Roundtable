import { generateObject, generateText, type LanguageModel } from 'ai';
import { IntakeResultSchema, type IntakeResult } from '../../contracts/index.js';
import type { IntakeClassifier } from '../nodes/intake.js';
import { heuristicIntake } from '../nodes/intake.js';
import { parseJsonFromText } from './json-text.js';
import { defaultOrchestratorModel } from './provider.js';

export interface LlmIntakeOpts {
  model?: LanguageModel;
  fallback?: IntakeClassifier;
  onError?: (error: unknown) => void;
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
- For a new feature, page, component, endpoint, workflow, or user-facing UI, \
  prefer multi_agent with planner, implementer, and reviewer unless it is a \
  tiny text-only edit.
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
      } catch (error) {
        opts.onError?.(error);
        try {
          return await classifyViaJsonText(model, message);
        } catch (jsonError) {
          opts.onError?.(jsonError);
        }
        // Falling back to the heuristic is safer than failing the whole turn
        // — the heuristic always returns *something* and the worst case is a
        // clarify prompt the user can answer.
        return fallback.classify(message);
      }
    },
  };
}

async function classifyViaJsonText(
  model: LanguageModel,
  message: string,
): Promise<IntakeResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text } = await generateText({
      model,
      system: `${SYSTEM_PROMPT}

Return only one valid JSON object with this exact shape:
{"intentType":"build|modify|inspect|debug|review|control","clarity":"clear|ambiguous","ambiguityScore":0,"complexity":"single_agent|multi_agent","risk":"low|medium|high","suggestedRoles":["planner"],"userVisibleSummary":"..."}`,
      prompt: [
        `User message:\n"""\n${message}\n"""`,
        attempt > 0
          ? 'Your previous response was not valid contract JSON. Return JSON only, with no prose or markdown.'
          : '',
      ].join('\n\n'),
    });
    try {
      return parseJsonFromText(text, IntakeResultSchema);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('json_text_intake_failed');
}
