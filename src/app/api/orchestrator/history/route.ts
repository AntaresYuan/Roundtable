import { listLocalTurns } from '@/server/local-turn-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const turns = await listLocalTurns();
    return Response.json({ ok: true, turns });
  } catch {
    return Response.json({ ok: false, error: 'history_load_failed' }, { status: 500 });
  }
}
