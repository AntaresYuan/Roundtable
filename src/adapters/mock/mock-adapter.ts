import { randomUUID } from 'node:crypto';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentSession,
  SessionOpts,
  UserInput,
} from '../../contracts/index.js';

export interface MockAdapterConfig {
  id?: string;
  displayName?: string;
  avatar?: string;
  scriptedEvents?: AgentEvent[];
}

const DEFAULT_SCRIPT: AgentEvent[] = [
  { type: 'thinking_delta', delta: 'planning...' },
  { type: 'text_delta', delta: 'Working on it.' },
  { type: 'done', finishReason: 'stop' },
];

const CAPABILITIES: AgentCapabilities = {
  streaming: true,
  toolUse: true,
  fileEdits: true,
  persistentSessions: false,
  mcp: false,
  multimodal: false,
};

export function createMockAdapter(config: MockAdapterConfig = {}): AgentAdapter {
  const script = config.scriptedEvents ?? DEFAULT_SCRIPT;
  const id = config.id ?? 'mock';

  return {
    id,
    displayName: config.displayName ?? 'Mock Agent',
    avatar: config.avatar ?? '🧪',
    capabilities: CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSession> {
      return createMockSession(id, opts, script);
    },
  };
}

function createMockSession(
  adapterId: string,
  opts: SessionOpts,
  script: AgentEvent[],
): AgentSession {
  let interrupted = false;
  const sessionId = opts.sessionId ?? (randomUUID() as string);

  return {
    id: sessionId,
    adapterId,
    cwd: opts.cwd,
    async *send(_input: UserInput): AsyncIterable<AgentEvent> {
      for (const event of script) {
        if (interrupted) {
          yield { type: 'error', message: 'interrupted', recoverable: false };
          return;
        }
        yield event;
      }
    },
    async interrupt(): Promise<void> {
      interrupted = true;
    },
    async close(): Promise<void> {
      interrupted = true;
    },
  };
}
