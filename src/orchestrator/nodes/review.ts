import type { OrchestratorState } from '../state.js';

export interface Reviewer {
  review(state: OrchestratorState): Promise<string[]>;
}

export function noopReviewer(): Reviewer {
  return {
    async review(): Promise<string[]> {
      return [];
    },
  };
}

const TRIGGERS = /\b(auth|password|secret|payment|prod|deploy|migration)\b/i;

export async function runReview(
  state: OrchestratorState,
  reviewer: Reviewer,
): Promise<OrchestratorState> {
  const touchesSensitive =
    TRIGGERS.test(state.userMessage) || state.intake?.risk === 'high';
  const changesCode = state.dispatch.some((record) =>
    record.events.some((event) => event.type === 'file_change'),
  );
  const notes =
    touchesSensitive || changesCode ? await reviewer.review(state) : [];
  return {
    ...state,
    reviewNotes: [...state.reviewNotes, ...notes],
    stage: 'aggregate',
  };
}
