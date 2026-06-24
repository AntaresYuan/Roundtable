import { loadMissionForChat } from '@/server/mission-query';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId') ?? undefined;
    const mission = await loadMissionForChat(chatId);
    return Response.json({ ok: true, mission });
  } catch {
    return Response.json({ ok: false, error: 'mission_load_failed' }, { status: 500 });
  }
}
