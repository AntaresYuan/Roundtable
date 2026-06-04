import type { OrchestratorState, ProposeSkillEvent } from '../state.js';

/** Hard cap on proposals per run (UI noise budget). Spec 100 §6 promotion. */
export const MAX_SKILL_PROPOSALS_PER_RUN = 2;

/**
 * Decides whether the PM should propose any reusable skill at aggregate
 * time. Returns 0+ `propose_skill` AgentEvents. The user must explicitly
 * save (ADR-007); these are *proposals*, not commits.
 */
export interface SkillProposer {
  propose(state: OrchestratorState): Promise<ProposeSkillEvent[]>;
}

/** Default. PM proposes nothing — preserves existing behavior pre-#119. */
export function noopSkillProposer(): SkillProposer {
  return {
    async propose(): Promise<ProposeSkillEvent[]> {
      return [];
    },
  };
}

/**
 * Run the proposer (if any), cap to MAX_SKILL_PROPOSALS_PER_RUN, validate
 * that emitted events are correctly shaped, and return them. Errors in the
 * proposer are swallowed (returning []) — a broken proposer must not break
 * the orchestrator run.
 */
export async function collectSkillProposals(
  state: OrchestratorState,
  proposer: SkillProposer | undefined,
): Promise<ProposeSkillEvent[]> {
  if (!proposer) return [];
  try {
    const raw = await proposer.propose(state);
    return raw
      .filter((e): e is ProposeSkillEvent => e?.type === 'propose_skill')
      .slice(0, MAX_SKILL_PROPOSALS_PER_RUN);
  } catch {
    return [];
  }
}
