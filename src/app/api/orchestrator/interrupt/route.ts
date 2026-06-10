import { z } from 'zod';
import { interruptDispatch } from '@/server/dispatch-control';
import { getLiveTurn, updateLiveTurn } from '@/server/local-turn-store';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  turnId: z.string().trim().min(1),
});

export async function POST(req: Request) {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ ok: false, error: 'invalid_interrupt_request' }, { status: 400 });
  }

  const turn = await getLiveTurn(body.data.turnId);
  if (!turn) {
    return Response.json({ ok: false, error: 'turn_not_found' }, { status: 404 });
  }
  if (turn.dispatchStatus !== 'running') {
    return Response.json({ ok: false, error: 'dispatch_not_running' }, { status: 409 });
  }

  const result = await interruptDispatch(body.data.turnId);
  if (!result.ok) {
    // The background promise already unwound (e.g. finished between the poll
    // and the click); report it so the client refreshes instead of erroring.
    return Response.json({ ok: false, error: 'dispatch_not_running' }, { status: 409 });
  }

  // Immediate feedback for the polling UI; the background dispatch persists
  // the final 'interrupted' state when it unwinds.
  await updateLiveTurn(body.data.turnId, (current) => ({
    ...current,
    dispatchStage: 'interrupting',
  }));

  return Response.json({ ok: true, sessions: result.sessions });
}
