import { describe, expect, it } from 'vitest';
import { runReview } from '../../src/orchestrator/nodes/review.js';
import { initialState } from '../../src/orchestrator/state.js';

describe('runReview', () => {
  it('runs reviewer for ordinary code changes', async () => {
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

    const result = await runReview(state, {
      async review() {
        calls += 1;
        return ['Check page rendering'];
      },
    });

    expect(calls).toBe(1);
    expect(result.reviewNotes).toEqual(['Check page rendering']);
    expect(result.stage).toBe('aggregate');
  });
});
