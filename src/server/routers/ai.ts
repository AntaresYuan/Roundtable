import { z } from 'zod';
import { generateText } from 'ai';
import { createTRPCRouter, protectedRateLimitedProcedure } from '../trpc.js';
import { defaultOrchestratorModel } from '../../orchestrator/llm/provider.js';

/**
 * Small LLM helper surface for the UI. NOTE (server lane, pending review): reuses the
 * orchestrator model (Anthropic) — needs ANTHROPIC_API_KEY set, else generateText throws
 * and the client shows the error.
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
});
