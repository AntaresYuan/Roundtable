// TODO(template): this is the ONLY file that should import vendor-specific
// types. Keep adapter.ts and session.ts clean of vendor SDKs.
//
// Map every distinct vendor event shape to one AgentEvent. If an event has
// no useful equivalent, drop it — do not invent placeholder events.

import type { AgentEvent } from '../../contracts/adapter';

// TODO(template): replace `unknown` with the vendor's event union type.
export function mapVendorEventToAgentEvent(raw: unknown): AgentEvent {
  void raw;
  // TODO(template): switch on raw.type and return the right AgentEvent.
  //
  // Example skeleton:
  //
  // switch ((raw as { type: string }).type) {
  //   case 'message_delta':
  //     return { type: 'text_delta', delta: (raw as ...).text };
  //   case 'tool_use':
  //     return { type: 'tool_use', id: ..., name: ..., input: ... };
  //   case 'tool_result':
  //     return { type: 'tool_result', id: ..., output: ..., isError: ... };
  //   case 'finish':
  //     return { type: 'done', usage: ..., finishReason: ... };
  //   default:
  //     throw new Error(`Unknown vendor event: ${JSON.stringify(raw)}`);
  // }
  throw new Error('TODO(template): implement mapVendorEventToAgentEvent');
}
