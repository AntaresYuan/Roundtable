import type { OrchestratorState, ClarifyQuestion, ClarifyState } from '../state.js';

const MAX_QUESTIONS = 3;

export interface ClarifyGenerator {
  generate(userMessage: string): Promise<ClarifyQuestion[]>;
}

export function fallbackClarify(): ClarifyGenerator {
  return {
    async generate(userMessage: string): Promise<ClarifyQuestion[]> {
      return [
        {
          id: 'scope',
          prompt: `What outcome do you want for: "${userMessage.slice(0, 60)}"?`,
          options: [
            { id: 'prototype', label: 'Quick prototype' },
            { id: 'production', label: 'Production-ready feature' },
            { id: 'investigate', label: 'Just investigate first' },
          ],
        },
      ];
    },
  };
}

export async function runClarify(
  state: OrchestratorState,
  generator: ClarifyGenerator,
): Promise<OrchestratorState> {
  if (state.clarify?.resolved) {
    return { ...state, stage: 'plan' };
  }

  const existing = state.clarify;
  const questions =
    existing?.questions ?? (await generator.generate(state.userMessage));
  const trimmed = questions.slice(0, MAX_QUESTIONS);
  const answers = existing?.answers ?? {};
  const resolved = trimmed.every((q) => q.id in answers);

  const clarify: ClarifyState = { questions: trimmed, answers, resolved };

  return {
    ...state,
    clarify,
    stage: resolved ? 'plan' : 'clarify',
  };
}

export function answerClarify(
  state: OrchestratorState,
  questionId: string,
  optionId: string,
): OrchestratorState {
  if (!state.clarify) return state;
  const answers = { ...state.clarify.answers, [questionId]: optionId };
  const resolved = state.clarify.questions.every((q) => q.id in answers);
  return {
    ...state,
    clarify: { ...state.clarify, answers, resolved },
  };
}
