import type { AgentCapabilities, SessionOpts, UserInput } from './session.js';
import type { AgentEvent } from './event.js';

export interface AgentSession {
  readonly id: string;
  readonly adapterId: string;
  readonly cwd: string;
  send(input: UserInput): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly avatar: string;
  readonly capabilities: AgentCapabilities;
  createSession(opts: SessionOpts): Promise<AgentSession>;
}
