import { randomUUID } from 'node:crypto';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentSession,
  SessionOpts,
  UserInput,
} from '../../contracts/index.js';
import { normalizeCodexLine, type CodexNormalizeContext } from './normalize.js';
import { spawnCodex, type CodexProcess, type SpawnCodexOpts } from './process.js';

export interface CodexAdapterConfig {
  id?: string;
  displayName?: string;
  avatar?: string;
  command?: string;
  /** Codex sandbox policy; the implementer needs `workspace-write` to land files. */
  sandbox?: string;
  /** Optional model override (`codex exec -m <model>`). */
  model?: string;
  extraArgs?: readonly string[];
  /** Test seam: inject a fake spawner so unit tests never hit a live model. */
  spawner?: (opts: SpawnCodexOpts) => CodexProcess;
}

const CAPABILITIES: AgentCapabilities = {
  streaming: true,
  toolUse: true,
  fileEdits: true,
  // codex exec is single-turn; we do not plumb `exec resume` yet.
  persistentSessions: false,
  mcp: true,
  multimodal: false,
};

export function createCodexAdapter(config: CodexAdapterConfig = {}): AgentAdapter {
  const id = config.id ?? 'codex';
  const command = config.command ?? 'codex';
  const sandbox = config.sandbox ?? 'workspace-write';
  const spawner = config.spawner ?? spawnCodex;
  const extraArgs = config.extraArgs ?? [];

  return {
    id,
    displayName: config.displayName ?? 'Codex',
    avatar: config.avatar ?? '🧩',
    capabilities: CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSession> {
      return createSession(id, command, sandbox, config.model, extraArgs, spawner, opts);
    },
  };
}

function createSession(
  adapterId: string,
  command: string,
  sandbox: string,
  model: string | undefined,
  extraArgs: readonly string[],
  spawner: (opts: SpawnCodexOpts) => CodexProcess,
  opts: SessionOpts,
): AgentSession {
  const sessionId = opts.sessionId ?? (randomUUID() as string);
  let active: CodexProcess | undefined;

  async function* run(input: UserInput): AsyncIterable<AgentEvent> {
    let emittedTerminalEvent = false;
    let emittedAnyEvent = false;
    let proc: CodexProcess | undefined;
    try {
      const args: string[] = [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '-s',
        sandbox,
        // Non-interactive: never block waiting for an approval prompt. Unquoted
        // so it survives shell parsing; codex stores it as the literal "never".
        '-c',
        'approval_policy=never',
      ];
      if (model) args.push('-m', model);
      args.push(...extraArgs);
      // `-` makes codex read the prompt from stdin, so arbitrary prompt text
      // never has to survive argv/shell quoting.
      args.push('-');

      // codex has no `--append-system-prompt`; fold the system prompt into the
      // turn text so the role instructions reach the model.
      proc = spawner({
        command,
        args,
        cwd: opts.cwd,
        stdin: buildPrompt(opts.systemPrompt, input.text),
      });
      active = proc;

      const normalizeCtx: CodexNormalizeContext = {};
      for await (const line of proc.lines()) {
        const events = normalizeCodexLine(line, normalizeCtx);
        for (const event of events) {
          emittedAnyEvent = true;
          if (event.type === 'done' || event.type === 'error') emittedTerminalEvent = true;
          yield event;
          if (event.type === 'done' || event.type === 'error') return;
        }
      }
      if (!emittedTerminalEvent) {
        const stderr = proc.stderrSnapshot().trim();
        if (stderr || !emittedAnyEvent) {
          yield {
            type: 'error',
            message: stderr || 'codex_exited_without_events',
            recoverable: false,
          };
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
      active?.signal('SIGINT');
    },
    async close(): Promise<void> {
      await active?.close();
    },
  };
}

function buildPrompt(systemPrompt: string | undefined, text: string): string {
  const trimmed = systemPrompt?.trim();
  if (!trimmed) return text;
  return `${trimmed}\n\n---\n\n${text}`;
}
