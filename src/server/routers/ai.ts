import { z } from 'zod';
import { generateObject, generateText } from 'ai';
import { desc, eq } from 'drizzle-orm';
import { createTRPCRouter, protectedProcedure, protectedRateLimitedProcedure } from '../trpc.js';
import { chats } from '../../db/schema.js';
import { defaultOrchestratorModel } from '../../orchestrator/llm/provider.js';

/**
 * Small LLM helper surface for the UI. NOTE (server lane, pending review): reuses the
 * PM-agent model via `defaultOrchestratorModel()` — the project's provider is 火山引擎 /
 * Volcano Engine (ADR-004; live wiring on the codex/deepseek-live-workflow branch), NOT
 * Anthropic. Needs that provider's key configured, else the call throws and the UI shows it.
 */
export const aiRouter = createTRPCRouter({
  // Refine a non-coder's plain-language request into a crisp task brief.
  polish: protectedRateLimitedProcedure
    .input(z.object({ text: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const { text } = await generateText({
        model: defaultOrchestratorModel(),
        system:
          "You refine a non-coder's plain-language build request into a crisp, unambiguous " +
          'task brief for a team of coding agents. Preserve their intent and language; tighten ' +
          'the wording and fold in the obvious acceptance criteria. Keep it to <=4 sentences. ' +
          'Return only the refined brief — no preamble, no markdown headers.',
        prompt: input.text,
      });
      return { text: text.trim() };
    }),

  // Personalized starter suggestions derived from the user's recent chats.
  suggestTasks: protectedProcedure.query(async ({ ctx }) => {
    const recent = await ctx.db
      .select({ title: chats.title })
      .from(chats)
      .where(eq(chats.ownerUserId, ctx.user.id))
      .orderBy(desc(chats.updatedAt))
      .limit(8);
    const { object } = await generateObject({
      model: defaultOrchestratorModel(),
      schema: z.object({ suggestions: z.array(z.string()).length(3) }),
      system:
        'Suggest 3 concrete next build tasks for a non-coder building with an agent team. ' +
        'Each <= 8 words, imperative, buildable. Bias toward what fits their recent work.',
      prompt: recent.length
        ? `Their recent tasks:\n${recent.map((r) => `- ${r.title}`).join('\n')}`
        : 'No history yet — suggest 3 broadly useful starter tasks.',
    });
    return object.suggestions;
  }),

  // Pick the best-fit workflow for a task description (drives the recommendation chip).
  recommendWorkflow: protectedProcedure
    .input(
      z.object({
        task: z.string().min(1).max(2000),
        workflows: z.array(z.object({ id: z.string(), name: z.string(), desc: z.string() })).min(1).max(20),
      }),
    )
    .query(async ({ input }) => {
      const ids = input.workflows.map((w) => w.id);
      const { object } = await generateObject({
        model: defaultOrchestratorModel(),
        schema: z.object({ workflowId: z.string(), reason: z.string() }),
        system:
          "Given a non-coder's build task and a list of available workflows (id + name + description), " +
          'pick the single best-fit workflow for the task. Reply with its exact id and a one-sentence reason (<=16 words).',
        prompt: `Task: ${input.task}\n\nWorkflows:\n${input.workflows.map((w) => `- ${w.id}: ${w.name} — ${w.desc}`).join('\n')}`,
      });
      return ids.includes(object.workflowId) ? object : null;
    }),
});
