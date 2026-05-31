import type { AgentEvent } from '../contracts/index.js';

export async function* createAgentEventStream(
  chatId: string,
): AsyncIterable<AgentEvent> {
  yield {
    type: 'text_delta',
    delta: `stream initialized for ${chatId}`,
  };
}
