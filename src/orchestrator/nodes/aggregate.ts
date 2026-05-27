import type { AggregateSummary, OrchestratorState } from '../state.js';

export function runAggregate(state: OrchestratorState): OrchestratorState {
  const completed = state.dispatch.filter((d) => d.status === 'completed').length;
  const failed = state.dispatch.filter((d) => d.status === 'failed').length;

  const bullets = state.dispatch
    .flatMap((d) =>
      d.events
        .filter((e) => e.type === 'file_change' || e.type === 'artifact')
        .map((e) => describeEvent(e)),
    )
    .slice(0, 5);

  const headline =
    failed > 0
      ? `Partial: ${completed} done, ${failed} failed.`
      : `Done: ${completed} tasks completed${
          state.reviewNotes.length > 0
            ? `, ${state.reviewNotes.length} review note${state.reviewNotes.length > 1 ? 's' : ''}`
            : ''
        }.`;

  const aggregate: AggregateSummary = {
    headline,
    bullets,
    quickActions:
      failed > 0
        ? [{ id: 'retry', label: 'Retry failed' }]
        : [
            { id: 'preview', label: 'Preview' },
            { id: 'deploy', label: 'Deploy' },
          ],
  };

  return { ...state, aggregate, stage: 'done' };
}

function describeEvent(e: { type: string } & Record<string, unknown>): string {
  if (e.type === 'file_change') return `${e['kind']}: ${e['path']}`;
  if (e.type === 'artifact') {
    const a = e['artifact'] as { title?: string } | undefined;
    return a?.title ?? 'artifact';
  }
  return e.type;
}
