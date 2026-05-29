// TODO(template): rename this class. This file implements AgentSession.
//
// Responsibility: own the live connection / subprocess for one session, and
// translate the vendor's event stream into AgentEvent via event-mapper.ts.

import type {
  AgentEvent,
  AgentSession,
  SessionOpts,
  UserInput,
} from '../../contracts/adapter';

// TODO(template): replace this alias with a vendor-specific options shape if needed.
export type YourAgentSessionOptions = SessionOpts;

export class YourAgentSession implements AgentSession {
  readonly id: string;
  readonly adapterId = 'your-agent';

  constructor(private opts: YourAgentSessionOptions) {
    this.id = opts.sessionId ?? crypto.randomUUID();
  }

  async *send(input: UserInput): AsyncIterable<AgentEvent> {
    // TODO(template):
    //   1. Open or reuse the vendor connection (subprocess, HTTP stream, ...).
    //   2. Send `input` to the vendor.
    //   3. For each vendor event, yield mapVendorEventToAgentEvent(raw).
    //   4. On stream end, yield { type: 'done', usage, finishReason }.
    //   5. On error, yield { type: 'error', message, recoverable }.
    //
    // Reminders:
    //   - Drain stderr in parallel with stdout for subprocess-based adapters.
    //   - Use a readline interface for NDJSON; do not buffer raw chunks.
    //   - Never write outside this.opts.cwd.
    void input;
    throw new Error('TODO(template): implement send()');
  }

  async interrupt(): Promise<void> {
    // TODO(template): send vendor-specific cancel signal (SIGTERM, abort, etc.).
    throw new Error('TODO(template): implement interrupt()');
  }

  async close(): Promise<void> {
    // TODO(template): release the connection / subprocess.
    throw new Error('TODO(template): implement close()');
  }
}
