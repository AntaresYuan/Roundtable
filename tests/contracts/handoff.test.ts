import { describe, expect, it } from 'vitest';
import { HandoffCardSchema } from '../../src/contracts/handoff.js';

describe('HandoffCardSchema', () => {
  it('round-trips a minimal card', () => {
    const card = HandoffCardSchema.parse({
      id: 'h1',
      from: 'orchestrator',
      to: 'implementer',
      scenario: 'dispatch',
      userIntent: 'add waitlist page',
      taskBrief: 'create /waitlist with CSV export',
      pinnedMessages: [],
      rolesInGroup: [],
      relevantArtifacts: [],
      fullHistoryRef: 'chat:abc',
      createdAt: new Date().toISOString(),
      generatedBy: 'orchestrator',
    });
    expect(card.scenario).toBe('dispatch');
  });

  it('caps pinned messages at 10', () => {
    const card = {
      id: 'h1',
      from: 'orchestrator',
      to: 'implementer',
      scenario: 'dispatch',
      userIntent: 'x',
      taskBrief: 'y',
      pinnedMessages: Array.from({ length: 11 }, (_, i) => ({
        id: `${i}`,
        content: 'p',
        pinnedBy: 'u',
      })),
      rolesInGroup: [],
      relevantArtifacts: [],
      fullHistoryRef: 'chat:abc',
      createdAt: new Date().toISOString(),
      generatedBy: 'orchestrator',
    };
    expect(() => HandoffCardSchema.parse(card)).toThrow();
  });
});
