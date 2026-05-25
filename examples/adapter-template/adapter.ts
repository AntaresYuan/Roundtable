// TODO(template): rename this file's class and update references in index.ts.
//
// This file implements the AgentAdapter interface. It should contain
// NO vendor-specific imports. All vendor types live in event-mapper.ts.

import type { AgentAdapter, AgentCapabilities, SessionOpts } from '../../contracts/adapter';
import { YourAgentSession } from './session';
import { CAPABILITIES } from './capabilities';

export class YourAgentAdapter implements AgentAdapter {
  readonly id = 'your-agent'; // TODO(template): kebab-case id
  readonly displayName = 'Your Agent'; // TODO(template): human-readable name
  readonly avatar = '/avatars/your-agent.png'; // TODO(template): path or data URI
  readonly capabilities: AgentCapabilities = CAPABILITIES;

  async createSession(opts: SessionOpts) {
    return new YourAgentSession(opts);
  }
}
