import { z } from 'zod';
import {
  dispatchApprovedLocalTurn,
  LocalDispatchError,
} from '@/server/local-dispatch';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  turnId: z.string().trim().min(1),
  agentAdapter: z.string().trim().optional(),
});

export async function POST(req: Request) {
  const body = BodySchema.safeParse(await req.json());
  if (!body.success) {
    return Response.json({ ok: false, error: 'invalid_dispatch_request' }, { status: 400 });
  }

  try {
    return Response.json(await dispatchApprovedLocalTurn(body.data.turnId, {
      ...(body.data.agentAdapter ? { agentAdapter: body.data.agentAdapter } : {}),
    }));
  } catch (error) {
    if (error instanceof LocalDispatchError) {
      return Response.json({ ok: false, error: error.code }, { status: error.status });
    }
    return Response.json({ ok: false, error: 'dispatch_failed' }, { status: 500 });
  }
}
