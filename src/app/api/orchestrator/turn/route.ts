import { z } from 'zod';
import { IntakeResultSchema, PlanSchema } from '@/contracts';
import {
  llmIntake,
  llmPlanner,
  orchestratorModelConfig,
  requireOrchestratorKey,
} from '@/orchestrator/llm';
import { initialState } from '@/orchestrator/state';
import { saveLocalTurn } from '@/server/local-turn-store';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  turnId: z.string().trim().min(1).optional(),
  chatId: z.string().optional(),
});

const TurnResponseSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  pmMessage: z.string(),
  needsApproval: z.literal(true),
  approvalStatus: z.literal('pending'),
  intake: IntakeResultSchema,
  plan: PlanSchema,
});

type TurnResponse = z.infer<typeof TurnResponseSchema>;

export async function POST(req: Request) {
  let turnId = `turn-${Date.now()}`;
  let message = '';
  let chatId: string | undefined;
  try {
    const body = BodySchema.safeParse(await req.json());
    if (!body.success) {
      return Response.json({ ok: false, error: 'message_required' }, { status: 400 });
    }

    turnId = body.data.turnId ?? turnId;
    message = body.data.message;
    chatId = body.data.chatId;
    requireOrchestratorKey();

    const llmErrors: unknown[] = [];
    const intake = await llmIntake({
      onError: (error) => llmErrors.push(error),
      fallback: {
        async classify() {
          throw llmErrors[0] ?? new Error('llm_intake_failed');
        },
      },
    }).classify(message);

    const state = {
      ...initialState(chatId ?? `local-${turnId}`, message),
      intake,
      stage: 'plan' as const,
    };

    const plan = await llmPlanner({
      onError: (error) => llmErrors.push(error),
      fallback: {
        async buildPlan() {
          throw llmErrors[llmErrors.length - 1] ?? new Error('llm_plan_failed');
        },
      },
    }).buildPlan(state);

    const config = orchestratorModelConfig();
    const response: TurnResponse = {
      ok: true,
      id: turnId,
      provider: config.provider,
      model: config.model,
      pmMessage: buildPmMessage(plan.tasks.length, intake.risk),
      needsApproval: true,
      approvalStatus: 'pending',
      intake,
      plan,
    };

    await saveLocalTurn({
      id: turnId,
      localChatId: chatId,
      message,
      status: 'done',
      createdAt: new Date().toISOString(),
      provider: response.provider,
      model: response.model,
      pmMessage: response.pmMessage,
      needsApproval: response.needsApproval,
      approvalStatus: 'pending',
      intake: response.intake,
      plan: response.plan,
    });

    return Response.json(TurnResponseSchema.parse(response));
  } catch (error) {
    const sanitized = sanitizeError(error);
    if (message) {
      await saveLocalTurn({
        id: turnId,
        localChatId: chatId,
        message,
        status: 'error',
        createdAt: new Date().toISOString(),
        error: sanitized,
      });
    }
    return Response.json({ ok: false, error: sanitized }, { status: 500 });
  }
}

function buildPmMessage(taskCount: number, risk: string): string {
  const suffix =
    risk === 'high'
      ? ' This looks high-risk, so I will not start work without your explicit approval.'
      : ' I will wait for your approval before dispatching any agents.';
  return `I drafted a ${taskCount}-task plan.${suffix}`;
}

function sanitizeError(error: unknown): string {
  if (!(error instanceof Error)) return 'llm_turn_failed';
  const message = error.message
    .replace(/\bsk-\S+/g, 'sk-[redacted]')
    .replace(/\b(k-cp-|eyJ)\S+/g, '[redacted]');
  if (
    process.env.NODE_ENV !== 'production' ||
    message.includes('API_KEY') ||
    message.includes('Unsupported ROUNDTABLE_LLM_PROVIDER') ||
    message.includes('insufficient balance')
  ) {
    return message;
  }
  return 'llm_turn_failed';
}
