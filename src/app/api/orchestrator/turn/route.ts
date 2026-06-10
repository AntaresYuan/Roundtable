import { z } from 'zod';
import {
  ArtifactIdSchema,
  ArtifactSchema,
  IntakeResultSchema,
  PlanSchema,
  WorkflowSchema,
  WorkflowRunSchema,
} from '@/contracts';
import type { Workflow } from '@/contracts';
import {
  llmIntake,
  llmPlanner,
  orchestratorModelConfig,
  requireOrchestratorKey,
} from '@/orchestrator/llm';
import { initialState } from '@/orchestrator/state';
import { heuristicIntake } from '@/orchestrator/nodes/intake';
import { rolePlanner, workflowPlanner } from '@/orchestrator/nodes/plan';
import { workflowRunFromState } from '@/orchestrator/workflow-run';
import { categorizeProviderError } from '@/orchestrator/llm/provider';
import { saveLiveTurn } from '@/server/local-turn-store';
import { buildTurnContextBlock } from '@/server/turn-context';
import { resolveChatWorkflow } from '@/server/workflows-query';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  turnId: z.string().trim().min(1).optional(),
  chatId: z.string().optional(),
  history: z
    .array(
      z.object({
        speaker: z.enum(['user', 'pm']),
        text: z.string().trim().min(1).max(1500),
      }),
    )
    .max(12)
    .optional(),
});

const TurnResponseSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  pmMessage: z.string(),
  needsApproval: z.literal(true),
  approvalStatus: z.literal('pending'),
  degraded: z.boolean().optional(),
  intake: IntakeResultSchema,
  plan: PlanSchema,
  artifacts: z.array(ArtifactSchema),
  workflow: WorkflowSchema.optional(),
  workflowRun: WorkflowRunSchema.optional(),
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
    // Demo-critical resilience: the turn must always produce a plan, even with
    // no API key or a flaky provider. We try the live LLM first, then fall back
    // to the deterministic heuristic intake/planner instead of failing the
    // whole turn. A throwing fallback here used to 500 the very first step of
    // the demo whenever the model hiccuped.
    // The turn must always produce a plan. We try the live LLM (which has its
    // own JSON-text retry for providers that reject json_schema structured
    // output, e.g. Volcano), and only mark the turn "degraded" when the
    // deterministic heuristic actually runs — i.e. no key, or every model path
    // failed. A model hiccup the JSON-text fallback recovers from is NOT degraded.
    const hasKey = orchestratorKeyPresent();
    let heuristicUsed = !hasKey;

    // Chat context (pins + recent history) rides along for the LLM intake and
    // planner only. The stored turn keeps the clean `message`, so the UI
    // bubble, artifacts, and HandoffCards never show the context block.
    const contextBlock = hasKey ? await buildTurnContextBlock(chatId, body.data.history) : null;
    const promptMessage = contextBlock
      ? `${contextBlock}\n\n[Current request]\n${message}`
      : message;

    const intake = hasKey
      ? await llmIntake({
          fallback: {
            async classify(text) {
              heuristicUsed = true;
              return heuristicIntake().classify(text);
            },
          },
        }).classify(promptMessage)
      : await heuristicIntake().classify(message);

    // Workflow-driven planning: if this chat's workbench has an active workflow,
    // the plan follows its stages 1:1 (workflowPlanner) instead of the generic
    // role planner. Resolution never throws — an unbound/unknown chat falls back
    // to the LLM/role planner so the logged-out demo still works.
    let workflow: Workflow | undefined;
    if (chatId) {
      workflow = (await resolveChatWorkflow(chatId)) ?? undefined;
    }

    const state = {
      ...initialState(chatId ?? `local-${turnId}`, promptMessage, workflow),
      intake,
      stage: 'plan' as const,
    };

    const plan = workflow
      ? await workflowPlanner().buildPlan(state)
      : hasKey
        ? await llmPlanner({
            fallback: {
              async buildPlan(planState) {
                heuristicUsed = true;
                return rolePlanner().buildPlan(planState);
              },
            },
          }).buildPlan(state)
        : await rolePlanner().buildPlan(state);

    // Project the not-yet-dispatched plan onto stage states so the workflow
    // strip shows every stage as pending the moment the plan is drafted.
    const workflowRun = workflow
      ? workflowRunFromState({ ...state, plan })
      : undefined;

    const degraded = heuristicUsed;
    const config = orchestratorModelConfig();
    const artifacts = buildTurnArtifacts(turnId, responseChatId(chatId, turnId), message, intake, plan);
    const response: TurnResponse = {
      ok: true,
      id: turnId,
      provider: config.provider,
      model: displayModel(config.provider, config.model),
      pmMessage: buildPmMessage(plan.tasks.length, intake.risk, degraded),
      needsApproval: true,
      approvalStatus: 'pending',
      ...(degraded ? { degraded: true } : {}),
      intake,
      plan,
      artifacts,
      ...(workflow ? { workflow } : {}),
      ...(workflowRun ? { workflowRun } : {}),
    };

    await saveLiveTurn({
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
      artifacts,
      ...(workflow ? { workflow } : {}),
      ...(workflowRun ? { workflowRun } : {}),
    });

    return Response.json(TurnResponseSchema.parse(response));
  } catch (error) {
    const sanitized = sanitizeError(error);
    if (message) {
      await saveLiveTurn({
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

function buildPmMessage(taskCount: number, risk: string, degraded = false): string {
  const suffix =
    risk === 'high'
      ? ' This looks high-risk, so I will not start work without your explicit approval.'
      : ' I will wait for your approval before dispatching any agents.';
  const note = degraded
    ? ' (Drafted with the built-in heuristic planner — the live model was unavailable, so double-check the plan before approving.)'
    : '';
  return `I drafted a ${taskCount}-task plan.${suffix}${note}`;
}

// Never surface an account-specific inference endpoint id (e.g. Volcano's
// `ep-...`) to clients. The provider name is enough for a "running on a real
// model" badge; the raw endpoint id is an internal resource identifier.
function displayModel(provider: string, model: string): string {
  if (provider === 'volcano' || /^ep-/.test(model)) return 'ark';
  return model;
}

function orchestratorKeyPresent(): boolean {
  try {
    requireOrchestratorKey();
    return true;
  } catch {
    return false;
  }
}

function responseChatId(chatId: string | undefined, turnId: string): string {
  return chatId ?? `local-${turnId}`;
}

function buildTurnArtifacts(
  turnId: string,
  chatId: string,
  message: string,
  intake: z.infer<typeof IntakeResultSchema>,
  plan: z.infer<typeof PlanSchema>,
): z.infer<typeof ArtifactSchema>[] {
  const createdAt = new Date();
  const intakeMarkdown = [
    `# Intake summary`,
    '',
    `- Chat: ${chatId}`,
    `- Intent: ${intake.intentType}`,
    `- Clarity: ${intake.clarity}`,
    `- Complexity: ${intake.complexity}`,
    `- Risk: ${intake.risk}`,
    `- Roles: ${intake.suggestedRoles.join(', ')}`,
    '',
    `## User request`,
    '',
    message,
    '',
    `## Summary`,
    '',
    intake.userVisibleSummary,
  ].join('\n');

  return [
    {
      id: ArtifactIdSchema.parse(`intake-${turnId}`),
      kind: 'markdown',
      title: `intake/${turnId}.md`,
      ownerAgentId: 'orchestrator',
      version: 1,
      uri: `turn://${turnId}/intake`,
      preview: `${intakeMarkdown}\n`,
      createdAt,
    },
    {
      id: ArtifactIdSchema.parse(`plan-${turnId}`),
      kind: 'spec',
      title: `plans/${turnId}.json`,
      ownerAgentId: 'orchestrator',
      version: 1,
      uri: `turn://${turnId}/plan`,
      preview: `${JSON.stringify(plan, null, 2)}\n`,
      createdAt,
    },
  ];
}

function sanitizeError(error: unknown): string {
  const categorized = categorizeProviderError(error);
  if (categorized.category !== 'unknown') return categorized.message;
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
