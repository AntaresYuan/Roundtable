import { describe, expect, it } from 'vitest';
import {
  createClaudeCodeAdapter,
  type CliProcess,
  type SpawnCliOpts,
} from '../../../src/adapters/claude-code/index.js';
import type { AgentEvent } from '../../../src/contracts/index.js';

function fakeSpawner(lines: string[]): {
  spawner: (opts: SpawnCliOpts) => CliProcess;
  written: string[];
  closed: { value: boolean };
  signals: string[];
} {
  const written: string[] = [];
  const signals: string[] = [];
  const closed = { value: false };

  const spawner = (_opts: SpawnCliOpts): CliProcess => ({
    pid: 12345,
    async *lines() {
      for (const line of lines) yield line;
    },
    async write(payload: string) {
      written.push(payload);
    },
    signal(sig) {
      signals.push(sig);
    },
    async close() {
      closed.value = true;
    },
    stderrSnapshot() {
      return '';
    },
  });

  return { spawner, written, closed, signals };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('createClaudeCodeAdapter', () => {
  it('streams normalized events from scripted stream-json', async () => {
    const { spawner, written } = fakeSpawner([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] },
      }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ]);

    const adapter = createClaudeCodeAdapter({ spawner });
    const session = await adapter.createSession({
      cwd: '/tmp/x',
      role: 'implementer',
      agentMeta: { displayName: 'cc', color: '#000' },
    });

    const events = await collect<AgentEvent>(session.send({ text: 'do it' }));
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'done']);
    expect(written[0]).toContain('"type":"user"');
    expect(written[0]).toContain('do it');
    await session.close();
  });

  it('stops streaming after done event', async () => {
    const { spawner } = fakeSpawner([
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'a' }] },
      }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'should-not-appear' }] },
      }),
    ]);

    const adapter = createClaudeCodeAdapter({ spawner });
    const session = await adapter.createSession({
      cwd: '/tmp/x',
      role: 'implementer',
      agentMeta: { displayName: 'cc', color: '#000' },
    });
    const events = await collect<AgentEvent>(session.send({ text: 'go' }));
    expect(events).toHaveLength(2);
  });

  it('interrupt sends SIGINT only after stream started', async () => {
    const { spawner, signals } = fakeSpawner([]);
    const adapter = createClaudeCodeAdapter({ spawner });
    const session = await adapter.createSession({
      cwd: '/tmp/x',
      role: 'implementer',
      agentMeta: { displayName: 'cc', color: '#000' },
    });
    await session.interrupt();
    expect(signals).toEqual([]);
    await collect(session.send({ text: 'go' }));
    await session.interrupt();
    expect(signals).toEqual(['SIGINT']);
  });

  it('close drains the child process', async () => {
    const { spawner, closed } = fakeSpawner([]);
    const adapter = createClaudeCodeAdapter({ spawner });
    const session = await adapter.createSession({
      cwd: '/tmp/x',
      role: 'implementer',
      agentMeta: { displayName: 'cc', color: '#000' },
    });
    await session.close();
    expect(closed.value).toBe(true);
  });
});
