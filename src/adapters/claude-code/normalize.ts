import type { AgentEvent } from '../../contracts/index.js';

/**
 * Claude Code emits `--output-format stream-json` as NDJSON. The exact envelope
 * is one of:
 *   { type: 'system', subtype: 'init', session_id, ... }
 *   { type: 'assistant', message: { content: [...] } }
 *   { type: 'user', message: { content: [{ tool_use_id, content }] } }
 *   { type: 'result', subtype: 'success' | 'error_max_turns' | ..., usage }
 *
 * `assistant.message.content` is the Anthropic message blocks shape:
 *   { type: 'text', text }
 *   { type: 'thinking', thinking }
 *   { type: 'tool_use', id, name, input }
 *
 * We map this back into our internal `AgentEvent` discriminated union.
 */

export interface NormalizeContext {
  sessionId?: string;
  onSessionId?: (id: string) => void;
}

export function normalizeStreamJsonLine(
  line: string,
  ctx: NormalizeContext = {},
): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let envelope: unknown;
  try {
    envelope = JSON.parse(trimmed);
  } catch {
    return [
      { type: 'error', message: `Invalid stream-json line: ${trimmed.slice(0, 200)}`, recoverable: true },
    ];
  }

  if (!isRecord(envelope)) return [];
  const type = envelope['type'];

  if (type === 'system' && envelope['subtype'] === 'init') {
    const sessionId = envelope['session_id'];
    if (typeof sessionId === 'string') ctx.onSessionId?.(sessionId);
    return [];
  }

  if (type === 'assistant') {
    const message = envelope['message'];
    if (!isRecord(message)) return [];
    const content = message['content'];
    if (!Array.isArray(content)) return [];
    return content.flatMap(normalizeContentBlock);
  }

  if (type === 'user') {
    const message = envelope['message'];
    if (!isRecord(message)) return [];
    const content = message['content'];
    if (!Array.isArray(content)) return [];
    const events: AgentEvent[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string') {
        events.push({
          type: 'tool_result',
          id: block['tool_use_id'],
          output: block['content'] ?? null,
          isError: block['is_error'] === true,
        });
      }
    }
    return events;
  }

  if (type === 'result') {
    const subtype = envelope['subtype'];
    const usage = isRecord(envelope['usage']) ? envelope['usage'] : undefined;
    if (subtype === 'success') {
      return [
        {
          type: 'done',
          finishReason: 'stop',
          ...(usage ? { usage: extractUsage(usage) } : {}),
        },
      ];
    }
    return [
      {
        type: 'error',
        message: typeof subtype === 'string' ? `result.${subtype}` : 'result.unknown',
        recoverable: subtype !== 'error_during_execution',
      },
    ];
  }

  return [];
}

function normalizeContentBlock(block: unknown): AgentEvent[] {
  if (!isRecord(block)) return [];
  const type = block['type'];

  if (type === 'text' && typeof block['text'] === 'string') {
    return [{ type: 'text_delta', delta: block['text'] }];
  }

  if (type === 'thinking' && typeof block['thinking'] === 'string') {
    return [{ type: 'thinking_delta', delta: block['thinking'] }];
  }

  if (type === 'tool_use' && typeof block['id'] === 'string' && typeof block['name'] === 'string') {
    const evt: AgentEvent = {
      type: 'tool_use',
      id: block['id'],
      name: block['name'],
      input: block['input'] ?? {},
    };
    const fileEvent = maybeFileChangeEvent(block['name'], block['input']);
    return fileEvent ? [evt, fileEvent] : [evt];
  }

  return [];
}

function maybeFileChangeEvent(name: unknown, input: unknown): AgentEvent | null {
  if (typeof name !== 'string' || !isRecord(input)) return null;
  const path = input['file_path'];
  if (typeof path !== 'string') return null;

  if (name === 'Write') {
    const content = typeof input['content'] === 'string' ? input['content'] : '';
    return { type: 'file_change', path, kind: 'create', diff: synthDiff('+', content) };
  }
  if (name === 'Edit') {
    const oldStr = typeof input['old_string'] === 'string' ? input['old_string'] : '';
    const newStr = typeof input['new_string'] === 'string' ? input['new_string'] : '';
    return {
      type: 'file_change',
      path,
      kind: 'edit',
      diff: `${synthDiff('-', oldStr)}\n${synthDiff('+', newStr)}`,
    };
  }
  return null;
}

function synthDiff(prefix: '+' | '-', body: string): string {
  return body
    .split('\n')
    .map((l) => `${prefix} ${l}`)
    .join('\n');
}

function extractUsage(usage: Record<string, unknown>): {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
} {
  const out: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } = {};
  if (typeof usage['input_tokens'] === 'number') out.inputTokens = usage['input_tokens'];
  if (typeof usage['output_tokens'] === 'number') out.outputTokens = usage['output_tokens'];
  if (typeof usage['cache_read_input_tokens'] === 'number') {
    out.cacheReadTokens = usage['cache_read_input_tokens'];
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
