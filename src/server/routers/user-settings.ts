import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { userSettings } from '../../db/index.js';
import {
  createTRPCRouter,
  protectedProcedure,
  protectedRateLimitedProcedure,
} from '../trpc.js';

const defaultLanguageSchema = z.enum(['auto', 'zh', 'en']);
const approvalModeSchema = z.enum(['always_ask', 'auto_safe_fixes', 'run_until_blocked']);
const runStyleSchema = z.enum(['fast', 'balanced', 'careful']);

const userSettingsUpdateInput = z.object({
  defaultLanguage: defaultLanguageSchema.optional(),
  defaultWorkflowId: z.string().uuid().nullable().optional(),
  approvalMode: approvalModeSchema.optional(),
  runStyle: runStyleSchema.optional(),
  learnPreferenceSuggestions: z.boolean().optional(),
  useSavedPreferencesInHandoffs: z.boolean().optional(),
});

const defaultSettings = (userId: string) => ({
  userId,
  defaultLanguage: 'auto' as const,
  defaultWorkflowId: null,
  approvalMode: 'always_ask' as const,
  runStyle: 'balanced' as const,
  learnPreferenceSuggestions: true,
  useSavedPreferencesInHandoffs: true,
  updatedAt: null,
});

export const userSettingsRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const [settings] = await ctx.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, ctx.user.id));
    return settings ?? defaultSettings(ctx.user.id);
  }),

  update: protectedRateLimitedProcedure
    .input(userSettingsUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, ctx.user.id));
      const current = existing ?? defaultSettings(ctx.user.id);
      const patch = {
        userId: ctx.user.id,
        defaultLanguage: input.defaultLanguage ?? current.defaultLanguage,
        defaultWorkflowId: input.defaultWorkflowId ?? current.defaultWorkflowId,
        approvalMode: input.approvalMode ?? current.approvalMode,
        runStyle: input.runStyle ?? current.runStyle,
        learnPreferenceSuggestions:
          input.learnPreferenceSuggestions ?? current.learnPreferenceSuggestions,
        useSavedPreferencesInHandoffs:
          input.useSavedPreferencesInHandoffs ?? current.useSavedPreferencesInHandoffs,
        updatedAt: new Date(),
      };

      const [settings] = await ctx.db
        .insert(userSettings)
        .values(patch)
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: {
            defaultLanguage: patch.defaultLanguage,
            defaultWorkflowId: patch.defaultWorkflowId,
            approvalMode: patch.approvalMode,
            runStyle: patch.runStyle,
            learnPreferenceSuggestions: patch.learnPreferenceSuggestions,
            useSavedPreferencesInHandoffs: patch.useSavedPreferencesInHandoffs,
            updatedAt: patch.updatedAt,
          },
        })
        .returning();

      ctx.logger.event('user_settings.updated', { userId: ctx.user.id });
      return settings;
    }),
});
