import { describe, expect, it } from 'vitest';
import { runReview } from '../../src/orchestrator/nodes/review.js';
import { initialState } from '../../src/orchestrator/state.js';
import type { ReviewComment } from '../../src/contracts/index.js';

describe('runReview', () => {
  it('records reviewer comments anchored to an artifact for code changes', async () => {
    let calls = 0;
    const state = {
      ...initialState('chat-1', 'build a page'),
      stage: 'review' as const,
      dispatch: [
        {
          taskId: 'T1',
          handoffCardId: 'h1',
          sessionId: 's1',
          status: 'completed' as const,
          startedAt: new Date(),
          finishedAt: new Date(),
          events: [
            {
              type: 'file_change' as const,
              path: 'app/page.tsx',
              kind: 'create' as const,
              diff: '+export default function Page() {}',
            },
          ],
        },
      ],
    };

    const comment: ReviewComment = {
      id: 'rc-1',
      artifactId: 'art-page',
      line: 1,
      body: 'Check page rendering',
      author: 'reviewer',
    };
    const result = await runReview(state, {
      async review() {
        calls += 1;
        return [comment];
      },
    });

    expect(calls).toBe(1);
    expect(result.reviewComments).toEqual([comment]);
    expect(result.reviewComments[0]?.artifactId).toBe('art-page');
    expect(result.stage).toBe('aggregate');
  });

  it('skips the reviewer when nothing sensitive or code-changing happened', async () => {
    let calls = 0;
    const state = {
      ...initialState('chat-1', 'just say hi'),
      stage: 'review' as const,
    };

    const result = await runReview(state, {
      async review() {
        calls += 1;
        return [];
      },
    });

    expect(calls).toBe(0);
    expect(result.reviewComments).toEqual([]);
    expect(result.stage).toBe('aggregate');
  });
});
