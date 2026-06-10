import type { ReviewComment } from '../../contracts/index.js';
import type { OrchestratorState } from '../state.js';

export interface Reviewer {
  /**
   * Returns review comments anchored to artifacts (`{ artifactId, line?, body }`),
   * not bare strings — so the gate/UI can tie each note to the file it concerns
   * (spec 080, gap 4). The reviewer receives `state.artifacts` to anchor against.
   */
  review(state: OrchestratorState): Promise<ReviewComment[]>;
}

export function noopReviewer(): Reviewer {
  return {
    async review(): Promise<ReviewComment[]> {
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
  const comments =
    touchesSensitive || changesCode ? await reviewer.review(state) : [];
  return {
    ...state,
    reviewComments: [...state.reviewComments, ...comments],
    stage: 'aggregate',
  };
}
