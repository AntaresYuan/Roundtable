import { describe, expect, it } from 'vitest';
import { AgentEventSchema } from '../../src/contracts/event.js';

describe('AgentEventSchema', () => {
  it('parses text_delta events', () => {
    const parsed = AgentEventSchema.parse({ type: 'text_delta', delta: 'hi' });
    expect(parsed.type).toBe('text_delta');
  });

  it('parses file_change events', () => {
    const parsed = AgentEventSchema.parse({
      type: 'file_change',
      path: 'src/a.ts',
      kind: 'create',
      diff: '+x',
    });
    expect(parsed.type).toBe('file_change');
  });

  it('rejects unknown event type', () => {
    expect(() =>
      AgentEventSchema.parse({ type: 'nope' } as unknown),
    ).toThrow();
  });

  it('requires recoverable flag on error', () => {
    expect(() =>
      AgentEventSchema.parse({ type: 'error', message: 'boom' } as unknown),
    ).toThrow();
  });
});
