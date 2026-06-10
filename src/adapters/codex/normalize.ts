import type { AgentEvent, TokenUsage } from '../../contracts/index.js';

/**
 * Maps the `codex exec --json` JSONL event stream to Roundtable `AgentEvent`s.
 * This is the ONLY place codex-specific wire types live (skill: add-agent-adapter).
 *
 * Confirmed event vocabulary (codex-cli 0.139):
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"id","type":"agent_message","text":"..."}}
 *   {"type":"turn.completed","usage":{"input_tokens","output_tokens","cached_input_tokens"}}
 *   {"type":"turn.failed","error":{"message":"..."}}
 *   {"type":"error","message":"..."}            // transient retry chatter
 *
 * `item.type` seen/expected: agent_message, reasoning, command_execution,
 * file_change (refined against a real implementer run), plus tool-ish kinds.
 */
export interface CodexNormalizeContext {
  /** codex thread id, captured for diagnostics / future `exec resume`. */
  threadId?: string;
  onThreadId?: (id: string) => void;
}

interface CodexLine {
  type?: string;
  thread_id?: string;
  message?: string;
  item?: CodexItem;
  usage?: CodexUsage;
  error?: { message?: string };
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  // command_execution
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  // file_change
  changes?: CodexFileChange[];
  path?: string;
  kind?: string;
  diff?: string;
  unified_diff?: string;
}

interface CodexFileChange {
  path?: string | undefined;
  kind?: string | undefined;
  diff?: string | undefined;
  unified_diff?: string | undefined;
}

interface CodexUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
}

export function normalizeCodexLine(
  line: string,
  ctx: CodexNormalizeContext,
): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== '{') return [];

  let event: CodexLine;
  try {
    event = JSON.parse(trimmed) as CodexLine;
  } catch {
    return [];
  }

  switch (event.type) {
    case 'thread.started':
      if (event.thread_id) {
        ctx.threadId = event.thread_id;
        ctx.onThreadId?.(event.thread_id);
      }
      return [];
    case 'turn.started':
      return [];
    case 'item.completed':
      return event.item ? mapItem(event.item) : [];
    case 'turn.completed':
      return [{ type: 'done', usage: mapUsage(event.usage) }];
    case 'turn.failed':
      return [
        {
          type: 'error',
          message: event.error?.message ?? 'codex_turn_failed',
          recoverable: false,
        },
      ];
    // Standalone `error` events are transient retry chatter ("Reconnecting…");
    // the terminal failure always arrives as `turn.failed`, so ignore these.
    case 'error':
      return [];
    default:
      return [];
  }
}

function mapItem(item: CodexItem): AgentEvent[] {
  switch (item.type) {
    case 'agent_message':
      return item.text ? [{ type: 'text_delta', delta: item.text }] : [];
    case 'reasoning':
      return item.text ? [{ type: 'thinking_delta', delta: item.text }] : [];
    case 'command_execution':
      return mapCommand(item);
    case 'file_change':
    case 'patch':
      return mapFileChanges(item);
    default:
      // Unknown tool-ish items (mcp_tool_call, web_search, todo_list, …): surface
      // as a generic tool_use so the timeline shows activity without crashing.
      if (item.type) {
        return [{ type: 'tool_use', id: item.id ?? item.type, name: item.type, input: item }];
      }
      return [];
  }
}

function mapCommand(item: CodexItem): AgentEvent[] {
  const id = item.id ?? 'cmd';
  const events: AgentEvent[] = [
    { type: 'tool_use', id, name: 'shell', input: { command: item.command ?? '' } },
  ];
  if (item.aggregated_output !== undefined || item.exit_code !== undefined) {
    events.push({
      type: 'tool_result',
      id,
      output: item.aggregated_output ?? '',
      isError: item.exit_code !== undefined && item.exit_code !== 0,
    });
  }
  return events;
}

function mapFileChanges(item: CodexItem): AgentEvent[] {
  const changes: CodexFileChange[] = item.changes ?? [
    { path: item.path, kind: item.kind, diff: item.diff ?? item.unified_diff },
  ];
  const events: AgentEvent[] = [];
  for (const change of changes) {
    if (!change.path) continue;
    events.push({
      type: 'file_change',
      path: change.path,
      kind: mapKind(change.kind),
      diff: change.diff ?? change.unified_diff ?? '',
    });
  }
  return events;
}

function mapKind(kind: string | undefined): 'create' | 'edit' | 'delete' {
  switch (kind) {
    case 'add':
    case 'create':
    case 'added':
      return 'create';
    case 'delete':
    case 'deleted':
    case 'remove':
      return 'delete';
    default:
      return 'edit';
  }
}

function mapUsage(usage: CodexUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const mapped: TokenUsage = {};
  if (usage.input_tokens !== undefined) mapped.inputTokens = usage.input_tokens;
  if (usage.output_tokens !== undefined) mapped.outputTokens = usage.output_tokens;
  if (usage.cached_input_tokens !== undefined) mapped.cacheReadTokens = usage.cached_input_tokens;
  return mapped;
}
