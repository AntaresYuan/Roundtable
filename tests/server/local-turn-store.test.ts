import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listLocalTurns,
  saveLocalTurn,
} from '../../src/server/local-turn-store.js';
import type { LocalTurn } from '../../src/server/local-turn-store.js';

describe('listLocalTurns', () => {
  let rootDir: string;
  let previousStore: string | undefined;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'roundtable-turn-store-'));
    previousStore = process.env['ROUNDTABLE_LOCAL_TURN_STORE'];
    process.env['ROUNDTABLE_LOCAL_TURN_STORE'] = join(rootDir, 'local-turns.json');
  });

  afterEach(async () => {
    if (previousStore === undefined) {
      delete process.env['ROUNDTABLE_LOCAL_TURN_STORE'];
    } else {
      process.env['ROUNDTABLE_LOCAL_TURN_STORE'] = previousStore;
    }
    await rm(rootDir, { recursive: true, force: true });
  });

  it('returns empty array when store does not exist yet', async () => {
    expect(await listLocalTurns()).toEqual([]);
    expect(await listLocalTurns('chat-x')).toEqual([]);
  });

  it('scopes turns by chatId (spec 100 §7 invariant 2)', async () => {
    await saveLocalTurn(turn('turn-a', 'chat-1'));
    await saveLocalTurn(turn('turn-b', 'chat-2'));
    await saveLocalTurn(turn('turn-c', 'chat-1'));

    const chat1 = await listLocalTurns('chat-1');
    expect(chat1.map((t) => t.id).sort()).toEqual(['turn-a', 'turn-c']);

    const chat2 = await listLocalTurns('chat-2');
    expect(chat2.map((t) => t.id)).toEqual(['turn-b']);

    const all = await listLocalTurns();
    expect(all).toHaveLength(3);
  });

  it('returns all turns when chatId is not provided (backward compat)', async () => {
    await saveLocalTurn(turn('turn-1', 'chat-a'));
    await saveLocalTurn(turn('turn-2', 'chat-b'));
    expect(await listLocalTurns()).toHaveLength(2);
  });

  it('returns empty array for a chatId with no matching turns', async () => {
    await saveLocalTurn(turn('turn-1', 'chat-a'));
    expect(await listLocalTurns('chat-z')).toEqual([]);
  });

  it('excludes turns with no localChatId when filtering by chatId', async () => {
    await saveLocalTurn(turn('turn-tagged', 'chat-1'));
    await saveLocalTurn(turn('turn-untagged'));
    expect(await listLocalTurns('chat-1')).toHaveLength(1);
    expect(await listLocalTurns()).toHaveLength(2);
  });
});

function turn(id: string, localChatId?: string): LocalTurn {
  return {
    id,
    localChatId,
    message: `Message for ${id}`,
    status: 'done',
    createdAt: new Date().toISOString(),
  };
}
