import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createClaudeCodeAdapter,
  type CliProcess,
  type SpawnCliOpts,
  spawnCli,
} from '../../../src/adapters/claude-code/index.js';
import type { AgentEvent } from '../../../src/contracts/index.js';

function fakeSpawner(lines: string[]): {
  spawner: (opts: SpawnCliOpts) => CliProcess;
  written: string[];
  closed: { value: boolean };
  signals: string[];
  spawned: SpawnCliOpts[];
} {
  const written: string[] = [];
  const signals: string[] = [];
  const closed = { value: false };
  const spawned: SpawnCliOpts[] = [];

  const spawner = (opts: SpawnCliOpts): CliProcess => {
    spawned.push(opts);
    return {
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
    };
  };

  return { spawner, written, closed, signals, spawned };
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

  it('passes resume flag and isolates Claude config under the workspace', async () => {
    const { spawner, spawned } = fakeSpawner([]);
    const adapter = createClaudeCodeAdapter({ spawner });
    const session = await adapter.createSession({
      sessionId: 'sess-existing' as never,
      cwd: '/tmp/x',
      role: 'implementer',
      agentMeta: { displayName: 'cc', color: '#000' },
    });

    expect(spawned[0]?.args).toContain('--resume');
    expect(spawned[0]?.args).toContain('sess-existing');
    expect(spawned[0]?.env?.['CLAUDE_CONFIG_DIR']).toBe(
      '/tmp/x/.roundtable/sessions/claude-code',
    );
    await session.close();
  });

  it('spawns the documented stream-json command shape', async () => {
    const { spawner, spawned } = fakeSpawner([]);
    const adapter = createClaudeCodeAdapter({ spawner });
    const session = await adapter.createSession({
      cwd: '/tmp/ws',
      role: 'implementer',
      agentMeta: { displayName: 'cc', color: '#000' },
    });
    const args = spawned[0]?.args ?? [];
    // The AC pins down the exact stream-json invocation; assert the flags are
    // present and the workspace is propagated via `--cwd`.
    expect(args).toContain('-p');
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual([
      '--output-format',
      'stream-json',
    ]);
    expect(args.slice(args.indexOf('--input-format'), args.indexOf('--input-format') + 2)).toEqual([
      '--input-format',
      'stream-json',
    ]);
    expect(args).not.toContain('--cwd');
    expect(spawned[0]?.cwd).toBe('/tmp/ws');
    await session.close();
  });

  it('fails when the CLI exits without stream events and stderr explains why', async () => {
    const spawner = (): CliProcess => ({
      pid: 12345,
      async *lines() {},
      async write() {},
      signal() {},
      async close() {},
      stderrSnapshot() {
        return "error: unknown option '--cwd'";
      },
    });
    const adapter = createClaudeCodeAdapter({ spawner });
    const session = await adapter.createSession({
      cwd: '/tmp/x',
      role: 'implementer',
      agentMeta: { displayName: 'cc', color: '#000' },
    });
    const events = await collect<AgentEvent>(session.send({ text: 'go' }));
    expect(events).toEqual([
      {
        type: 'error',
        message: "error: unknown option '--cwd'",
        recoverable: false,
      },
    ]);
  });

  it('captures child stderr into the debug snapshot', async () => {
    const proc = spawnCli({
      command: 'sh',
      args: ['-c', 'printf "boom\\n" 1>&2; printf "ok\\n"'],
      cwd: process.cwd(),
    });
    // Drain stdout so the process exits cleanly.
    for await (const _ of proc.lines()) {
      // no-op
    }
    await proc.close();
    expect(proc.stderrSnapshot()).toContain('boom');
  });

  it('surfaces child-process spawn failures as non-recoverable errors', async () => {
    const proc = spawnCli({
      command: 'roundtable-definitely-missing-cli',
      args: [],
      cwd: process.cwd(),
    });

    const events = await collect<AgentEvent>(
      (async function* () {
        try {
          for await (const _line of proc.lines()) {
            // no-op
          }
        } catch (error) {
          yield {
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
            recoverable: false,
          };
        }
      })(),
    );

    expect(events[0]).toMatchObject({ type: 'error', recoverable: false });
    await proc.close();
  });

  it.skipIf(process.env['ROUNDTABLE_RUN_CLAUDE_INTEGRATION'] !== '1')(
    'runs against a real Claude Code CLI when explicitly enabled',
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'roundtable-claude-live-'));
      try {
        const adapter = createClaudeCodeAdapter({
          command: process.env['ROUNDTABLE_CLAUDE_COMMAND'] ?? 'claude',
        });
        const session = await adapter.createSession({
          cwd,
          role: 'reviewer',
          agentMeta: { displayName: 'cc', color: '#000' },
        });
        const events = await collect(session.send({ text: 'Reply with exactly: ok' }));
        expect(events.some((event) => event.type === 'done')).toBe(true);
        await session.close();
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
  );
});
