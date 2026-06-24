import { clearLiveTurns, listLiveTurns } from '@/server/local-turn-store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId') ?? undefined;
    const turns = await listLiveTurns(chatId);
    return Response.json({ ok: true, turns });
  } catch {
    return Response.json({ ok: false, error: 'history_load_failed' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId') ?? undefined;
    await clearLiveTurns(chatId);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: 'history_clear_failed' }, { status: 500 });
  }
}
