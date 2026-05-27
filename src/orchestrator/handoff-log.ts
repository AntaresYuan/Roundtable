import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HandoffCard } from '../contracts/index.js';

export interface HandoffLog {
  append(card: HandoffCard): Promise<void>;
  entries(): readonly HandoffLogEntry[];
}

export interface HandoffLogEntry {
  id: string;
  from: string;
  to: string;
  card_id: string;
  user_intent: string;
  ts: string;
}

export function inMemoryHandoffLog(): HandoffLog {
  const buf: HandoffLogEntry[] = [];
  return {
    async append(card: HandoffCard): Promise<void> {
      buf.push(toEntry(card));
    },
    entries(): readonly HandoffLogEntry[] {
      return buf;
    },
  };
}

export function fileHandoffLog(path: string): HandoffLog {
  const buf: HandoffLogEntry[] = [];
  return {
    async append(card: HandoffCard): Promise<void> {
      const entry = toEntry(card);
      buf.push(entry);
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
    },
    entries(): readonly HandoffLogEntry[] {
      return buf;
    },
  };
}

function toEntry(card: HandoffCard): HandoffLogEntry {
  return {
    id: card.id,
    from: card.from,
    to: card.to,
    card_id: card.id,
    user_intent: card.userIntent,
    ts: card.createdAt.toISOString(),
  };
}
