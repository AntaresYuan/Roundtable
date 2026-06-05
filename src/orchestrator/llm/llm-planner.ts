import { randomUUID } from 'node:crypto';
import { generateObject, generateText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { PlanTaskSchema, type Plan } from '../../contracts/index.js';
import type { Planner } from '../nodes/plan.js';
import { rolePlanner } from '../nodes/plan.js';
import type { OrchestratorState } from '../state.js';
import { parseJsonFromText } from './json-text.js';
import { defaultOrchestratorModel } from './provider.js';

export interface LlmPlannerOpts {
  model?: LanguageModel;
  fallback?: Planner;
  onError?: (error: unknown) => void;
}

// The LLM produces tasks without an id (we assign T1..Tn) and without
// createdAt (we stamp it). Everything else round-trips through the contract.
const LlmPlanTaskSchema = PlanTaskSchema.omit({ id: true, status: true, deps: true }).extend({
  deps: z.array(z.union([z.string(), z.number()])).default([]),
});
const LlmPlanShapeSchema = z.object({
  tasks: z.array(LlmPlanTaskSchema).min(1).max(8),
});
const LlmPlanTextTaskSchema = LlmPlanTaskSchema;
const LlmPlanTextShapeSchema = z.object({
  tasks: z.array(LlmPlanTextTaskSchema).min(1).max(8),
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
      } catch (error) {
        opts.onError?.(error);
        try {
          const rawPlan = await planViaJsonText(model, state);
          return assemblePlan(rawPlan.tasks);
        } catch (jsonError) {
          opts.onError?.(jsonError);
        }
        return fallback.buildPlan(state);
      }
    },
  };
}

async function planViaJsonText(
  model: LanguageModel,
  state: OrchestratorState,
): Promise<z.infer<typeof LlmPlanShapeSchema>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text } = await generateText({
      model,
      system: `${SYSTEM_PROMPT}

Return only one valid JSON object with this exact shape:
{"tasks":[{"title":"Short imperative task","assignee":"@implementer","deps":[],"parallel":false,"user_visible":true}]}`,
      prompt: [
        buildPrompt(state),
        attempt > 0
          ? 'Your previous response was not valid contract JSON. Return JSON only, with no prose or markdown.'
          : '',
      ].join('\n\n'),
    });
    try {
      const parsed = parseJsonFromText(text, LlmPlanTextShapeSchema);
      return {
        tasks: parsed.tasks.map((task) => ({
          ...task,
          deps: task.deps.map(normalizeDep),
        })),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('json_text_plan_failed');
}

function normalizeDep(dep: string | number): string {
  if (typeof dep === 'number') return `T${Math.max(1, dep)}`;
  if (/^\d+$/.test(dep)) return `T${Math.max(1, parseInt(dep, 10))}`;
  if (/^T0$/.test(dep)) return 'T1';
  return dep;
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
    deps: t.deps.map(normalizeDep).filter((d) => {
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
