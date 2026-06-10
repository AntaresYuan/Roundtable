import { getDbClient } from '../db/index.js';
import { loadPinnedForHandoff } from './pinned-helpers.js';

export interface TurnHistoryEntry {
  speaker: 'user' | 'pm';
  text: string;
}

/** Keep the context block well under the 4k message cap so the current
 *  request always survives intact. */
const MAX_CONTEXT_CHARS = 2400;

/**
 * Build the chat-context block prepended to the user message for LLM intake
 * and planning (spec 030 § context): inherited pins (workbench + chat, via
 * `loadPinnedForHandoff`) plus the recent conversation the client sent along.
 *
 * Never throws — context is best-effort. Unknown chats (logged-out demo) and
 * a missing DB simply contribute no pins. Returns null when there is nothing
 * to add so callers can skip the block entirely.
 */
export async function buildTurnContextBlock(
  chatId: string | undefined,
  history: TurnHistoryEntry[] | undefined,
): Promise<string | null> {
  const sections: string[] = [];
  if (chatId) {
    try {
      const pins = await loadPinnedForHandoff(getDbClient().db, chatId);
      if (pins.length > 0) {
        sections.push(
          'Pinned constraints (user-curated, always follow):\n' +
            pins.map((pin) => `- ${pin.content}`).join('\n'),
        );
      }
    } catch {
      // No DB / unknown chat — pins are optional context.
    }
  }
  if (history && history.length > 0) {
    const lines = history.map(
      (entry) =>
        `${entry.speaker === 'user' ? 'User' : 'PM'}: ${entry.text.replace(/\s+/g, ' ').trim()}`,
    );
    sections.push('Recent conversation:\n' + lines.join('\n'));
  }
  if (sections.length === 0) return null;
  const block = `[Chat context — background for the request below]\n\n${sections.join('\n\n')}`;
  return block.length > MAX_CONTEXT_CHARS ? `${block.slice(0, MAX_CONTEXT_CHARS)}…` : block;
}
