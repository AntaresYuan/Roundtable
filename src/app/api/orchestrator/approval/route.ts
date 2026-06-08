import { z } from 'zod';
import {
  dispatchApprovedLocalTurn,
  LocalDispatchError,
} from '@/server/local-dispatch';
import {
  getLiveTurn,
  resolveLiveTurnApproval,
} from '@/server/local-turn-store';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  turnId: z.string().trim().min(1),
  decision: z.enum(['approve', 'request_changes']).default('approve'),
  autoDispatch: z.boolean().default(false),
  agentAdapter: z.string().trim().optional(),
});

export async function POST(req: Request) {
  const body = BodySchema.safeParse(await req.json());
  if (!body.success) {
    return Response.json({ ok: false, error: 'invalid_approval_request' }, { status: 400 });
  }

  const currentTurn = await getLiveTurn(body.data.turnId);
  if (!currentTurn) {
    return Response.json({ ok: false, error: 'turn_not_found' }, { status: 404 });
  }
  if (currentTurn.status !== 'done' || !currentTurn.plan || !currentTurn.intake) {
    return Response.json({ ok: false, error: 'turn_has_no_plan' }, { status: 409 });
  }

  const turn = await resolveLiveTurnApproval(body.data.turnId, body.data.decision);
  if (!turn) {
    return Response.json({ ok: false, error: 'turn_not_found' }, { status: 404 });
  }

  let dispatch: Awaited<ReturnType<typeof dispatchApprovedLocalTurn>> | undefined;
  if (body.data.decision === 'approve' && body.data.autoDispatch) {
    try {
      dispatch = await dispatchApprovedLocalTurn(turn.id, {
        ...(body.data.agentAdapter ? { agentAdapter: body.data.agentAdapter } : {}),
      });
    } catch (error) {
      if (error instanceof LocalDispatchError) {
        return Response.json({ ok: false, error: error.code }, { status: error.status });
      }
      return Response.json({ ok: false, error: 'dispatch_failed' }, { status: 500 });
    }
  }

  return Response.json({
    ok: true,
    id: turn.id,
    needsApproval: turn.needsApproval,
    approvalStatus: turn.approvalStatus,
    approvedAt: turn.approvedAt,
    ...(dispatch ? {
      dispatchStatus: dispatch.dispatchStatus,
      dispatchAdapter: dispatch.dispatchAdapter,
      dispatchedAt: dispatch.dispatchedAt,
      dispatchStage: dispatch.dispatchStage,
      dispatchError: dispatch.dispatchError,
      workspacePath: dispatch.workspacePath,
      records: dispatch.records,
      artifacts: dispatch.artifacts,
    } : {}),
  });
}
