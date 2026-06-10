import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import {
  MAX_SKILL_PROPOSALS_PER_RUN,
  noopSkillProposer,
  type SkillProposer,
} from '../nodes/skill-proposer.js';
import type { OrchestratorState, ProposeSkillEvent } from '../state.js';
import { defaultOrchestratorModel } from './provider.js';

export interface LlmSkillProposerOpts {
  model?: LanguageModel;
  fallback?: SkillProposer;
}

const LlmSkillSchema = z.object({
  name: z.string().min(1).max(160),
  triggerHint: z.string().min(1).max(500),
  body: z.string().min(1),
  rationale: z.string().optional(),
});
const LlmSkillsShapeSchema = z.object({
  skills: z.array(LlmSkillSchema).max(MAX_SKILL_PROPOSALS_PER_RUN),
});

const SYSTEM_PROMPT = `You are the Roundtable PM, reviewing a completed run to \
decide if any reusable pattern emerged that the user might want to save as a \
"skill" — a small, named, reusable note that gets auto-mounted into future \
HandoffCards when its trigger keywords match.

Propose AT MOST ${MAX_SKILL_PROPOSALS_PER_RUN} skills, and ONLY when the run \
produced a non-obvious, reusable pattern the user will likely hit again. \
Examples worth proposing:
- "user prefers server actions for form submission" (a recurring preference)
- "this codebase uses Drizzle migrations with explicit backfill UPDATE" \
  (a project-specific convention)

Do NOT propose:
- One-off facts about this specific request.
- Patterns the agent invented but the user didn't validate.
- Trivial conventions any beginner knows.

For each skill:
- name: short, outcome-oriented (max 60 chars). e.g. "server-action form submit".
- triggerHint: comma-separated keywords that should match future HandoffCards.
  Pick 3-6 specific keywords likely to appear in similar tasks.
- body: 1-3 sentence imperative instruction the agent should follow.
- rationale (optional): why this is worth saving.

If nothing in the run rises to that bar, return { "skills": [] }.`;

/**
 * LLM-backed skill proposer. Examines a completed run and proposes 0-2
 * reusable skills. Falls back to `noopSkillProposer` on any error so a
 * broken model client never breaks aggregate.
 */
export function llmSkillProposer(opts: LlmSkillProposerOpts = {}): SkillProposer {
  const model = opts.model ?? defaultOrchestratorModel();
  const fallback = opts.fallback ?? noopSkillProposer();

  return {
    async propose(state: OrchestratorState): Promise<ProposeSkillEvent[]> {
      try {
        const { object } = await generateObject({
          model,
          schema: LlmSkillsShapeSchema,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(state),
        });
        return object.skills.map((s) => ({
          type: 'propose_skill' as const,
          name: s.name,
          triggerHint: s.triggerHint,
          body: s.body,
          ...(s.rationale !== undefined ? { rationale: s.rationale } : {}),
        }));
      } catch {
        return fallback.propose(state);
      }
    },
  };
}

function buildPrompt(state: OrchestratorState): string {
  const completedTasks = state.dispatch
    .filter((d) => d.status === 'completed')
    .map((d) => `- ${d.taskId}: ${state.plan?.tasks.find((t) => t.id === d.taskId)?.title ?? '?'}`)
    .join('\n');
  const artifactTitles = state.artifacts.map((a) => `- ${a.title}`).join('\n');
  const reviewNotes = state.reviewComments
    .slice(0, 3)
    .map((c) => c.body)
    .join('\n');

  return [
    `User request:\n"""\n${state.userMessage}\n"""`,
    completedTasks ? `Completed tasks:\n${completedTasks}` : 'No tasks completed.',
    artifactTitles ? `Artifacts produced:\n${artifactTitles}` : 'No artifacts produced.',
    reviewNotes ? `Reviewer notes (top 3):\n${reviewNotes}` : 'No reviewer notes.',
    `Decide whether anything in this run is worth saving as a reusable skill.`,
  ].join('\n\n');
}
