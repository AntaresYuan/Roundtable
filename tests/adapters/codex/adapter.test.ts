import { describe, expect, it } from 'vitest';
import {
  createCodexAdapter,
  type CodexProcess,
  type SpawnCodexOpts,
} from '../../../src/adapters/codex/index.js';
import type { AgentEvent, SessionOpts } from '../../../src/contracts/index.js';

function fakeSpawner(lines: string[]): {
  spawner: (opts: SpawnCodexOpts) => CodexProcess;
  spawned: SpawnCodexOpts[];
  signals: string[];
  closed: { value: boolean };
} {
  const spawned: SpawnCodexOpts[] = [];
  const signals: string[] = [];
  const closed = { value: false };
  const spawner = (opts: SpawnCodexOpts): CodexProcess => {
    spawned.push(opts);
    return {
      pid: 4242,
      async *lines() {
        for (const line of lines) yield line;
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
    };
  };
  return { spawner, spawned, signals, closed };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

const opts: SessionOpts = {
  cwd: '/tmp/ws',
  role: 'implementer',
  agentMeta: { displayName: 'Codex', color: '#0a0' },
};

// Real `codex exec --json` capture (codex-cli 0.139).
const OK_STREAM = [
  '{"type":"thread.started","thread_id":"019eb176-415e-7533"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}',
  '{"type":"turn.completed","usage":{"input_tokens":11965,"cached_input_tokens":3968,"output_tokens":5}}',
];

describe('createCodexAdapter', () => {
  it('streams the captured codex turn as text_delta + done', async () => {
    const { spawner } = fakeSpawner(OK_STREAM);
    const adapter = createCodexAdapter({ spawner });
    const session = await adapter.createSession(opts);
    const events = await collect(session.send({ text: 'say OK' }));
    expect(events).toEqual<AgentEvent[]>([
      { type: 'text_delta', delta: 'OK' },
      { type: 'done', usage: { inputTokens: 11965, outputTokens: 5, cacheReadTokens: 3968 } },
    ]);
  });

  it('invokes `codex exec --json` with a workspace-write sandbox and feeds the prompt via stdin', async () => {
    const { spawner, spawned } = fakeSpawner(OK_STREAM);
    const adapter = createCodexAdapter({ spawner });
    const session = await adapter.createSession({ ...opts, systemPrompt: 'You are the implementer.' });
    await collect(session.send({ text: 'build the page' }));
    const args = spawned[0]!.args;
    expect(args.slice(0, 6)).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-c',
    ]);
    // Prompt is read from stdin (`-`), not argv, so it dodges shell quoting.
    expect(args[args.length - 1]).toBe('-');
    expect(spawned[0]!.stdin).toContain('You are the implementer.');
    expect(spawned[0]!.stdin).toContain('build the page');
    expect(spawned[0]!.cwd).toBe('/tmp/ws');
  });

  it('stops after a terminal error and ignores later lines', async () => {
    const { spawner } = fakeSpawner([
      '{"type":"turn.failed","error":{"message":"boom"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"late"}}',
    ]);
    const adapter = createCodexAdapter({ spawner });
    const session = await adapter.createSession(opts);
    const events = await collect(session.send({ text: 'x' }));
    expect(events).toEqual<AgentEvent[]>([{ type: 'error', message: 'boom', recoverable: false }]);
  });
});
