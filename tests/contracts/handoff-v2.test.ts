import { describe, expect, it } from 'vitest';
import {
  HANDOFF_CARD_V2_VERSION,
  HandoffCardSchema,
  HandoffCardV2Schema,
  handoffCardToV2,
  handoffCardV2ToLegacy,
  toHandoffV2ProtocolPayload,
  type HandoffCard,
  type HandoffCardV2,
} from '../../src/contracts/index.js';

function v2Card(): HandoffCardV2 {
  return HandoffCardV2Schema.parse({
    protocolVersion: HANDOFF_CARD_V2_VERSION,
    cardId: 'card-1',
    missionId: 'mission-1',
    scenario: 'agent_handoff',
    fromAgent: '@implementer',
    toAgent: '@reviewer',
    sourceTaskId: 'build__0',
    referenceTaskIds: ['plan__0'],
    task: { taskId: 'review__0', contextId: 'mission-1', title: 'Review invite flow', state: 'submitted' },
    human: {
      userIntent: 'Add team invitations',
      taskBrief: 'Review the invitation flow implementation',
      summary: 'Implemented the invite API and email send path.',
      openQuestions: ['Is rate limiting required for resend?'],
      rolesInGroup: [
        { agentId: 'reviewer', role: 'reviewer', displayName: 'Rví', color: '#33aa88' },
      ],
    },
    contextPackage: {
      pinnedMessages: [{ id: 'pin-1', content: 'Must support SSO orgs', pinnedBy: 'user' }],
      taskReferences: [{ taskId: 'build__0', state: 'completed' }],
      artifactRefs: [{ id: 'art-invite-api', kind: 'code', title: 'invite-api.ts' }],
      fullHistoryRef: 'chat:chat-1',
    },
    artifacts: [{ id: 'art-invite-api', kind: 'code', title: 'invite-api.ts' }],
    nextAction: {
      instruction: 'Confirm the invite flow meets the acceptance criteria',
      acceptanceCriteria: ['Covers SSO orgs', 'Has tests'],
    },
    risks: [{ severity: 'medium', description: 'Resend path is untested' }],
    provenance: { generatedBy: 'agent', sourceAgentId: 'implementer', sourceAgentRole: 'implementer' },
    createdAt: '2026-06-19T02:00:00Z',
  });
}

function legacyCard(): HandoffCard {
  return HandoffCardSchema.parse({
    id: 'legacy-1',
    from: 'orchestrator',
    to: '@implementer',
    scenario: 'dispatch',
    userIntent: 'Add team invitations',
    taskBrief: 'Implement the invitation flow',
    pinnedMessages: [{ id: 'pin-1', content: 'Must support SSO orgs', pinnedBy: 'user' }],
    rolesInGroup: [],
    previousAgent: {
      summary: 'Planner produced the task breakdown.',
      keyOutputs: [{ id: 'art-plan', kind: 'markdown', title: 'plan.md' }],
      openQuestions: ['Which auth provider?'],
    },
    relevantArtifacts: [{ id: 'art-plan', kind: 'markdown', title: 'plan.md' }],
    fullHistoryRef: 'chat:chat-1',
    createdAt: '2026-06-19T01:00:00Z',
    generatedBy: 'orchestrator',
  });
}

describe('HandoffCardV2Schema', () => {
  it('parses a full V2 card with human and protocol layers', () => {
    const card = v2Card();
    expect(card.protocolVersion).toBe(2);
    expect(card.task.taskId).toBe('review__0');
    expect(card.referenceTaskIds).toEqual(['plan__0']);
    expect(card.human.openQuestions).toEqual(['Is rate limiting required for resend?']);
  });

  it('rejects a wrong protocol version', () => {
    expect(() => HandoffCardV2Schema.parse({ ...v2Card(), protocolVersion: 1 })).toThrow();
  });

  it('caps pinned messages at 10', () => {
    const pinned = Array.from({ length: 11 }, (_, i) => ({
      id: `pin-${i}`,
      content: `c${i}`,
      pinnedBy: 'user',
    }));
    expect(() =>
      HandoffCardV2Schema.parse({
        ...v2Card(),
        contextPackage: { ...v2Card().contextPackage, pinnedMessages: pinned },
      }),
    ).toThrow();
  });
});

describe('handoffCardV2ToLegacy', () => {
  it('renders into a valid legacy card preserving the readable fields', () => {
    const legacy = handoffCardV2ToLegacy(v2Card());

    expect(() => HandoffCardSchema.parse(legacy)).not.toThrow();
    expect(legacy).toMatchObject({
      id: 'card-1',
      from: '@implementer',
      to: '@reviewer',
      userIntent: 'Add team invitations',
      taskBrief: 'Review the invitation flow implementation',
    });
    expect(legacy.previousAgent?.summary).toBe('Implemented the invite API and email send path.');
    expect(legacy.previousAgent?.openQuestions).toEqual(['Is rate limiting required for resend?']);
  });

  it('dedupes artifacts that appear in both artifacts and the context package', () => {
    const legacy = handoffCardV2ToLegacy(v2Card());
    expect(legacy.relevantArtifacts).toHaveLength(1);
    expect(legacy.relevantArtifacts[0]?.id).toBe('art-invite-api');
  });

  it('omits previousAgent when the V2 card has no summary', () => {
    const card = HandoffCardV2Schema.parse({
      ...v2Card(),
      human: { ...v2Card().human, summary: undefined },
    });
    expect(handoffCardV2ToLegacy(card).previousAgent).toBeUndefined();
  });
});

describe('handoffCardToV2', () => {
  it('upgrades a legacy card into a valid V2 card', () => {
    const upgraded = handoffCardToV2(legacyCard(), { missionId: 'mission-9' });

    expect(() => HandoffCardV2Schema.parse(upgraded)).not.toThrow();
    expect(upgraded).toMatchObject({
      protocolVersion: 2,
      cardId: 'legacy-1',
      missionId: 'mission-9',
      fromAgent: 'orchestrator',
      toAgent: '@implementer',
    });
    expect(upgraded.task.taskId).toBe('legacy-1');
    expect(upgraded.human.summary).toBe('Planner produced the task breakdown.');
    expect(upgraded.artifacts[0]?.id).toBe('art-plan');
    expect(upgraded.contextPackage.fullHistoryRef).toBe('chat:chat-1');
  });

  it('round-trips legacy → V2 → legacy preserving core readable fields', () => {
    const original = legacyCard();
    const back = handoffCardV2ToLegacy(handoffCardToV2(original));
    expect(back).toMatchObject({
      userIntent: original.userIntent,
      taskBrief: original.taskBrief,
      fullHistoryRef: original.fullHistoryRef,
    });
  });
});

describe('toHandoffV2ProtocolPayload', () => {
  it('carries references only — no raw history or artifact bodies', () => {
    const payload = toHandoffV2ProtocolPayload(v2Card());

    expect(payload.instruction).toBe('Confirm the invite flow meets the acceptance criteria');
    expect(payload.pinnedConstraints).toEqual(['Must support SSO orgs']);
    expect(payload.referenceTaskIds).toEqual(['plan__0']);
    expect(payload.artifactRefs).toEqual([
      { id: 'art-invite-api', kind: 'code', title: 'invite-api.ts' },
    ]);
    // Artifact refs must not leak content/preview bodies.
    for (const ref of payload.artifactRefs) {
      expect(ref).not.toHaveProperty('preview');
      expect(ref).not.toHaveProperty('content');
    }
    expect(payload.fullHistoryRef).toBe('chat:chat-1');
  });
});
