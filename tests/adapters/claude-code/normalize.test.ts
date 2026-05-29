import { describe, expect, it } from 'vitest';
import { normalizeStreamJsonLine } from '../../../src/adapters/claude-code/normalize.js';

describe('normalizeStreamJsonLine', () => {
  it('ignores blank lines', () => {
    expect(normalizeStreamJsonLine('')).toEqual([]);
    expect(normalizeStreamJsonLine('   ')).toEqual([]);
  });

  it('captures session id from system.init', () => {
    let captured: string | undefined;
    const events = normalizeStreamJsonLine(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-42' }),
      { onSessionId: (id) => (captured = id) },
    );
    expect(events).toEqual([]);
    expect(captured).toBe('sess-42');
  });

  it('maps assistant text content to text_delta', () => {
    const events = normalizeStreamJsonLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
    );
    expect(events).toEqual([{ type: 'text_delta', delta: 'hello' }]);
  });

  it('maps thinking blocks to thinking_delta', () => {
    const events = normalizeStreamJsonLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'planning' }] },
      }),
    );
    expect(events).toEqual([{ type: 'thinking_delta', delta: 'planning' }]);
  });

  it('waits for successful Write tool_result before emitting file_change and artifact', () => {
    const ctx = {
      pendingToolUses: new Map(),
      ownerAgentId: 'cc',
      now: () => new Date('2026-05-25T00:00:00Z'),
    };
    const toolUseEvents = normalizeStreamJsonLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'Write',
              input: { file_path: 'src/a.ts', content: 'export const x = 1' },
            },
          ],
        },
      }),
      ctx,
    );
    expect(toolUseEvents).toEqual([
      { type: 'tool_use', name: 'Write', id: 'tu1', input: { file_path: 'src/a.ts', content: 'export const x = 1' } },
    ]);

    const resultEvents = normalizeStreamJsonLine(
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }],
        },
      }),
      ctx,
    );
    expect(resultEvents).toHaveLength(3);
    expect(resultEvents[0]).toMatchObject({ type: 'tool_result', id: 'tu1', isError: false });
    expect(resultEvents[1]).toMatchObject({ type: 'file_change', path: 'src/a.ts', kind: 'create' });
    expect(resultEvents[2]).toMatchObject({
      type: 'artifact',
      artifact: { kind: 'file', title: 'src/a.ts', uri: 'src/a.ts', ownerAgentId: 'cc' },
    });
  });

  it('maps successful Edit tool_result to file_change(edit) with diff', () => {
    const ctx = { pendingToolUses: new Map() };
    normalizeStreamJsonLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu2',
              name: 'Edit',
              input: { file_path: 'a.ts', old_string: 'foo', new_string: 'bar' },
            },
          ],
        },
      }),
      ctx,
    );
    const events = normalizeStreamJsonLine(
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'ok', is_error: false }],
        },
      }),
      ctx,
    );
    const fileChange = events.find((e) => e.type === 'file_change');
    expect(fileChange).toMatchObject({ kind: 'edit', path: 'a.ts' });
    expect(fileChange && 'diff' in fileChange ? fileChange.diff : '').toContain('- foo');
    expect(fileChange && 'diff' in fileChange ? fileChange.diff : '').toContain('+ bar');
  });

  it('does not emit file_change when Write tool_result is an error', () => {
    const ctx = { pendingToolUses: new Map() };
    normalizeStreamJsonLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'Write',
              input: { file_path: 'src/a.ts', content: 'x' },
            },
          ],
        },
      }),
      ctx,
    );
    const events = normalizeStreamJsonLine(
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'denied', is_error: true }],
        },
      }),
      ctx,
    );
    expect(events).toEqual([
      { type: 'tool_result', id: 'tu1', output: 'denied', isError: true },
    ]);
  });

  it('maps user tool_result to tool_result event', () => {
    const events = normalizeStreamJsonLine(
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }],
        },
      }),
    );
    expect(events).toEqual([{ type: 'tool_result', id: 'tu1', output: 'ok', isError: false }]);
  });

  it('maps result.success to done with usage', () => {
    const events = normalizeStreamJsonLine(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
      }),
    );
    expect(events).toEqual([
      {
        type: 'done',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3 },
      },
    ]);
  });

  it('maps non-success result to error', () => {
    const events = normalizeStreamJsonLine(
      JSON.stringify({ type: 'result', subtype: 'error_max_turns' }),
    );
    expect(events[0]).toMatchObject({ type: 'error', message: 'result.error_max_turns' });
  });

  it('returns recoverable error on malformed JSON', () => {
    const events = normalizeStreamJsonLine('{not-json');
    expect(events[0]).toMatchObject({ type: 'error', recoverable: true });
  });
});
