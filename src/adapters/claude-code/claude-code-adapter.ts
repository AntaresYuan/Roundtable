import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentSession,
  SessionOpts,
  UserInput,
} from '../../contracts/index.js';
import { normalizeStreamJsonLine, type NormalizeContext } from './normalize.js';
import { spawnCli, type CliProcess, type SpawnCliOpts } from './process.js';

export interface ClaudeCodeAdapterConfig {
  id?: string;
  displayName?: string;
  avatar?: string;
  command?: string;
  extraArgs?: readonly string[];
  /** Test seam: inject a fake spawner for unit tests. */
  spawner?: (opts: SpawnCliOpts) => CliProcess;
}

const CAPABILITIES: AgentCapabilities = {
  streaming: true,
  toolUse: true,
  fileEdits: true,
  persistentSessions: true,
  mcp: true,
  multimodal: false,
};

export function createClaudeCodeAdapter(config: ClaudeCodeAdapterConfig = {}): AgentAdapter {
  const id = config.id ?? 'claude-code';
  const command = config.command ?? 'claude';
  const spawner = config.spawner ?? spawnCli;
  const extraArgs = config.extraArgs ?? [];

  return {
    id,
    displayName: config.displayName ?? 'Claude Code',
    avatar: config.avatar ?? '🤖',
    capabilities: CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSession> {
      return createSession(id, command, extraArgs, spawner, opts);
    },
  };
}

function createSession(
  adapterId: string,
  command: string,
  extraArgs: readonly string[],
  spawner: (opts: SpawnCliOpts) => CliProcess,
  opts: SessionOpts,
): AgentSession {
  const sessionId = opts.sessionId ?? (randomUUID() as string);
  const args: string[] = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--cwd',
    opts.cwd,
    '--verbose',
  ];
  if (opts.systemPrompt) {
    args.push('--append-system-prompt', opts.systemPrompt);
  }
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push('--allowed-tools', opts.allowedTools.join(','));
  }
  if (opts.sessionId) {
    args.push('--resume', opts.sessionId);
  }
  args.push(...extraArgs);

  const sessionDir = join(opts.cwd, '.roundtable', 'sessions', adapterId);
  mkdirSync(sessionDir, { recursive: true });

  const proc = spawner({
    command,
    args,
    cwd: opts.cwd,
    env: { CLAUDE_CONFIG_DIR: sessionDir },
  });
  let serverSessionId: string | undefined;
  let started = false;
  const normalizeCtx: NormalizeContext = {
    ownerAgentId: adapterId,
    pendingToolUses: new Map(),
  };
  normalizeCtx.onSessionId = (id) => {
    serverSessionId = id;
    normalizeCtx.sessionId = id;
  };

  async function* run(input: UserInput): AsyncIterable<AgentEvent> {
    try {
      const payload = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: input.text },
      });
      await proc.write(`${payload}\n`);
      started = true;

      for await (const line of proc.lines()) {
        if (serverSessionId !== undefined) normalizeCtx.sessionId = serverSessionId;
        const events = normalizeStreamJsonLine(line, normalizeCtx);
        for (const event of events) {
          yield event;
          if (event.type === 'done' || event.type === 'error') return;
        }
      }
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      };
    }
  }

  return {
    id: sessionId,
    adapterId,
    cwd: opts.cwd,
    send(input: UserInput): AsyncIterable<AgentEvent> {
      return run(input);
    },
    async interrupt(): Promise<void> {
      if (started) proc.signal('SIGINT');
    },
    async close(): Promise<void> {
      await proc.close();
    },
  };
}
