import type { AggregateSummary, OrchestratorState } from '../state.js';
import { collectSkillProposals, type SkillProposer } from './skill-proposer.js';

export async function runAggregate(
  state: OrchestratorState,
  proposer?: SkillProposer,
): Promise<OrchestratorState> {
  const completed = state.dispatch.filter((d) => d.status === 'completed').length;
  const failed = state.dispatch.filter((d) => d.status === 'failed').length;

  const artifactBullets = state.artifacts.map((a) => a.title);
  const fileChangeBullets = state.dispatch.flatMap((d) =>
    d.events
      .filter((e) => e.type === 'file_change')
      .map((e) => describeEvent(e)),
  );
  const bullets = [...artifactBullets, ...fileChangeBullets].slice(0, 5);

  const headline =
    failed > 0
      ? `Partial: ${completed} done, ${failed} failed.`
      : `Done: ${completed} tasks completed${
          state.reviewComments.length > 0
            ? `, ${state.reviewComments.length} review note${state.reviewComments.length > 1 ? 's' : ''}`
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

  const proposals = await collectSkillProposals(state, proposer);
  return {
    ...state,
    aggregate,
    proposedSkills: [...state.proposedSkills, ...proposals],
    stage: 'done',
  };
}

function describeEvent(e: { type: string } & Record<string, unknown>): string {
  if (e.type === 'file_change') return `${e['kind']}: ${e['path']}`;
  return e.type;
}
