import { z } from 'zod';
import { resolveLocalTurnApproval } from '@/server/local-turn-store';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  turnId: z.string().trim().min(1),
  decision: z.enum(['approve', 'request_changes']).default('approve'),
});

export async function POST(req: Request) {
  const body = BodySchema.safeParse(await req.json());
  if (!body.success) {
    return Response.json({ ok: false, error: 'invalid_approval_request' }, { status: 400 });
  }

  const turn = await resolveLocalTurnApproval(body.data.turnId, body.data.decision);
  if (!turn) {
    return Response.json({ ok: false, error: 'turn_not_found' }, { status: 404 });
  }

  return Response.json({
    ok: true,
    id: turn.id,
    needsApproval: turn.needsApproval,
    approvalStatus: turn.approvalStatus,
    approvedAt: turn.approvedAt,
  });
}
