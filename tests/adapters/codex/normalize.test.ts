import { describe, expect, it } from 'vitest';
import { normalizeCodexLine } from '../../../src/adapters/codex/normalize.js';

describe('normalizeCodexLine', () => {
  it('ignores blank and non-JSON lines', () => {
    expect(normalizeCodexLine('', {})).toEqual([]);
    expect(normalizeCodexLine('   ', {})).toEqual([]);
    expect(normalizeCodexLine('Reading additional input from stdin...', {})).toEqual([]);
  });

  it('captures thread_id from thread.started and emits nothing', () => {
    let captured: string | undefined;
    const events = normalizeCodexLine(
      JSON.stringify({ type: 'thread.started', thread_id: 'th-1' }),
      { onThreadId: (id) => (captured = id) },
    );
    expect(events).toEqual([]);
    expect(captured).toBe('th-1');
  });

  it('maps an agent_message item to text_delta', () => {
    const events = normalizeCodexLine(
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: 'OK' },
      }),
      {},
    );
    expect(events).toEqual([{ type: 'text_delta', delta: 'OK' }]);
  });

  it('maps a reasoning item to thinking_delta', () => {
    const events = normalizeCodexLine(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'reasoning', text: 'thinking it through' },
      }),
      {},
    );
    expect(events).toEqual([{ type: 'thinking_delta', delta: 'thinking it through' }]);
  });

  it('maps a command_execution item to tool_use + tool_result', () => {
    const events = normalizeCodexLine(
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'ls -la',
          aggregated_output: 'file.txt',
          exit_code: 0,
        },
      }),
      {},
    );
    expect(events).toEqual([
      { type: 'tool_use', id: 'cmd-1', name: 'shell', input: { command: 'ls -la' } },
      { type: 'tool_result', id: 'cmd-1', output: 'file.txt', isError: false },
    ]);
  });

  it('maps a file_change item (changes array) to file_change events', () => {
    const events = normalizeCodexLine(
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'file_change',
          changes: [
            { path: 'a.ts', kind: 'add', diff: '+a' },
            { path: 'b.ts', kind: 'update', unified_diff: '~b' },
          ],
        },
      }),
      {},
    );
    expect(events).toEqual([
      { type: 'file_change', path: 'a.ts', kind: 'create', diff: '+a' },
      { type: 'file_change', path: 'b.ts', kind: 'edit', diff: '~b' },
    ]);
  });

  it('maps turn.completed to done with normalized usage', () => {
    const events = normalizeCodexLine(
      JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 100, output_tokens: 5, cached_input_tokens: 40 },
      }),
      {},
    );
    expect(events).toEqual([
      { type: 'done', usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 40 } },
    ]);
  });

  it('maps turn.failed to a non-recoverable error', () => {
    const events = normalizeCodexLine(
      JSON.stringify({ type: 'turn.failed', error: { message: 'boom' } }),
      {},
    );
    expect(events).toEqual([{ type: 'error', message: 'boom', recoverable: false }]);
  });

  it('ignores transient standalone error (reconnect) events', () => {
    const events = normalizeCodexLine(
      JSON.stringify({ type: 'error', message: 'Reconnecting... 2/5' }),
      {},
    );
    expect(events).toEqual([]);
  });
});
