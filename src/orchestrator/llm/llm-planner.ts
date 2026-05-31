import { randomUUID } from 'node:crypto';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { PlanTaskSchema, type Plan } from '../../contracts/index.js';
import type { Planner } from '../nodes/plan.js';
import { rolePlanner } from '../nodes/plan.js';
import type { OrchestratorState } from '../state.js';
import { defaultOrchestratorModel } from './provider.js';

export interface LlmPlannerOpts {
  model?: LanguageModel;
  fallback?: Planner;
}

// The LLM produces tasks without an id (we assign T1..Tn) and without
// createdAt (we stamp it). Everything else round-trips through the contract.
const LlmPlanTaskSchema = PlanTaskSchema.omit({ id: true, status: true });
const LlmPlanShapeSchema = z.object({
  tasks: z.array(LlmPlanTaskSchema).min(1).max(8),
});

const SYSTEM_PROMPT = `You are the Roundtable PM planner. Given a classified \
intake and the user's request, produce a TodoList of 1-8 tasks for coding \
agents to execute.

Rules:
- assignee must be one of: @architect, @planner, @implementer, @reviewer, \
  @fixer. Pick the right role per task; do not name vendors.
- deps is a list of earlier task ids (T1, T2, ...) by *position* — task at \
  index i can only depend on tasks at indices < i. Use [] for the first task.
- parallel: true only when a task can safely run alongside its siblings.
- user_visible: false for purely internal scaffolding tasks, true otherwise.
- Titles must be short imperative sentences (<=70 chars).
- Never split into more tasks than the work warrants.`;

export function llmPlanner(opts: LlmPlannerOpts = {}): Planner {
  const model = opts.model ?? defaultOrchestratorModel();
  const fallback = opts.fallback ?? rolePlanner();

  return {
    async buildPlan(state: OrchestratorState): Promise<Plan> {
      try {
        const { object } = await generateObject({
          model,
          schema: LlmPlanShapeSchema,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(state),
        });
        return assemblePlan(object.tasks);
      } catch {
        return fallback.buildPlan(state);
      }
    },
  };
}

function buildPrompt(state: OrchestratorState): string {
  const intake = state.intake;
  const intakeSummary = intake
    ? `intent=${intake.intentType}, clarity=${intake.clarity}, complexity=${intake.complexity}, risk=${intake.risk}, suggestedRoles=${intake.suggestedRoles.join(',')}`
    : 'unknown';
  return [
    `User request:\n"""\n${state.userMessage}\n"""`,
    `Intake classification: ${intakeSummary}`,
    `Produce a JSON plan matching the schema.`,
  ].join('\n\n');
}

function assemblePlan(rawTasks: z.infer<typeof LlmPlanTaskSchema>[]): Plan {
  const tasks = rawTasks.map((t, i) => ({
    ...t,
    id: `T${i + 1}`,
    status: 'pending' as const,
    // Re-validate deps: drop any reference to a position >= this one.
    deps: t.deps.filter((d) => {
      const m = /^T(\d+)$/.exec(d);
      return m && parseInt(m[1]!, 10) - 1 < i;
    }),
  }));
  return {
    id: randomUUID() as string,
    createdAt: new Date(),
    tasks,
  };
}
