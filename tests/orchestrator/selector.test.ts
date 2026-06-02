import { describe, expect, it } from 'vitest';
import type {
  AgentDescription,
  AgentId,
  ChatId,
  SelectorDecision,
} from '../../src/contracts/index.js';
import {
  DEFAULT_SELECTOR_CONFIDENCE_THRESHOLD,
  SELECTOR_CLARIFY_MIN_AGENTS,
  heuristicSelector,
  inMemorySelectorTelemetry,
  runSelector,
  type SelectorInput,
  type SpeakerSelector,
} from '../../src/orchestrator/index.js';
import { llmSelector } from '../../src/orchestrator/llm/index.js';

const chatId = 'chat-fixture' as ChatId;

function agent(
  id: string,
  displayName: string,
  description: string,
  capabilities: string[] = [],
  role: AgentDescription['role'] = 'implementer',
): AgentDescription {
  return {
    id: id as AgentId,
    displayName,
    role,
    description,
    capabilities,
  };
}

function scriptedSelector(decision: SelectorDecision): SpeakerSelector {
  return { async select() { return decision; } };
}

describe('runSelector — fixture scenarios', () => {
  it('clear-target: high confidence, no clarify fallback', async () => {
    const agents = [
      agent('a-frontend', 'frontend', 'frontend specialist', ['react', 'css']),
      agent('a-backend', 'backend', 'API endpoints', ['api', 'database']),
      agent('a-reviewer', 'reviewer', 'reviews PRs', ['review'], 'reviewer'),
    ];
    const input: SelectorInput = {
      userMessage: 'add a react component for the css grid',
      agents,
    };

    const result = await runSelector(input, { chatId });

    expect(result.decision.chosenAgentId).toBe('a-frontend');
    expect(result.decision.confidence).toBeGreaterThanOrEqual(
      DEFAULT_SELECTOR_CONFIDENCE_THRESHOLD,
    );
    expect(result.clarifyQuestion).toBeNull();
    expect(result.fallbackTriggered).toBe(false);
  });

  it('ambiguous in a ≥4-agent room: clarify question lists chosen + runner-up', async () => {
    const agents = [
      agent('a1', 'frontend', 'ui work', ['react']),
      agent('a2', 'backend', 'api work', ['api']),
      agent('a3', 'design', 'design work', ['css']),
      agent('a4', 'tester', 'qa work', ['tests']),
    ];
    // Scripted low-confidence pick with an explicit runner-up.
    const decision: SelectorDecision = {
      chosenAgentId: 'a1' as AgentId,
      confidence: 0.4,
      reasoning: 'Tied keyword match.',
      runnersUp: [{ agentId: 'a2' as AgentId, confidence: 0.35 }],
    };
    const input: SelectorInput = {
      userMessage: 'do something with the thing',
      agents,
    };

    const result = await runSelector(input, {
      chatId,
      selector: scriptedSelector(decision),
    });

    expect(result.fallbackTriggered).toBe(true);
    expect(result.clarifyQuestion).not.toBeNull();
    expect(result.clarifyQuestion?.id).toBe('selector_speaker');
    const optionIds = (result.clarifyQuestion?.options ?? []).map((o) => o.id);
    expect(optionIds).toContain('a1');
    expect(optionIds).toContain('a2');
  });

  it('no-match: empty roster returns null choice with zero confidence', async () => {
    const result = await runSelector(
      { userMessage: 'anybody home?', agents: [] },
      { chatId },
    );

    expect(result.decision.chosenAgentId).toBeNull();
    expect(result.decision.confidence).toBe(0);
    expect(result.clarifyQuestion).toBeNull();
    expect(result.fallbackTriggered).toBe(false);
  });

  it('does not clarify in small rooms even with low confidence', async () => {
    // Three agents = below the SELECTOR_CLARIFY_MIN_AGENTS guard.
    expect(SELECTOR_CLARIFY_MIN_AGENTS).toBe(4);
    const agents = [
      agent('a1', 'one', 'general', []),
      agent('a2', 'two', 'general', []),
      agent('a3', 'three', 'general', []),
    ];
    const result = await runSelector(
      { userMessage: 'hi', agents },
      {
        chatId,
        selector: scriptedSelector({
          chosenAgentId: 'a1' as AgentId,
          confidence: 0.2,
          reasoning: 'low',
          runnersUp: [],
        }),
      },
    );
    expect(result.fallbackTriggered).toBe(false);
    expect(result.clarifyQuestion).toBeNull();
  });

  it('writes one telemetry entry per call with the right shape', async () => {
    const telemetry = inMemorySelectorTelemetry();
    const agents = [agent('a1', 'one', 'frontend', ['react'])];
    await runSelector(
      { userMessage: 'react work', agents },
      { chatId, telemetry, now: () => new Date('2026-05-31T00:00:00Z') },
    );
    const entries = telemetry.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      ts: '2026-05-31T00:00:00.000Z',
      chatId,
      userMessage: 'react work',
      agentCount: 1,
      fallbackTriggered: false,
    });
    expect(entries[0]?.decision.chosenAgentId).toBe('a1');
  });
});

describe('heuristicSelector', () => {
  it('boosts agents whose capability tags match user-message tokens', async () => {
    const s = heuristicSelector();
    const decision = await s.select({
      userMessage: 'refactor the api authentication',
      agents: [
        agent('ui', 'ui', 'frontend', ['react']),
        agent('be', 'be', 'backend service', ['api', 'auth']),
      ],
    });
    expect(decision.chosenAgentId).toBe('be');
    expect(decision.confidence).toBeGreaterThan(0.5);
  });

  it('returns no choice when no keyword matches so callers can fall through', async () => {
    const s = heuristicSelector();
    const decision = await s.select({
      userMessage: 'asdfasdf zzzz',
      agents: [agent('a1', 'one', 'irrelevant'), agent('a2', 'two', 'irrelevant')],
    });
    expect(decision.chosenAgentId).toBeNull();
    expect(decision.confidence).toBe(0);
    expect(decision.runnersUp.map((r) => r.agentId)).toEqual(['a1', 'a2']);
  });
});

describe('llmSelector', () => {
  it.skipIf(!process.env['ANTHROPIC_API_KEY'])(
    'selects from the supplied roster with the real LLM',
    async () => {
      const agents = [
        agent('a-frontend', 'frontend', 'frontend specialist', ['react', 'css']),
        agent('a-backend', 'backend', 'API endpoints', ['api', 'database']),
        agent('a-reviewer', 'reviewer', 'reviews PRs', ['review'], 'reviewer'),
      ];
      const s = llmSelector();
      const decision = await s.select({
        userMessage: 'Please review the pull request for regressions and missing tests.',
        agents,
      });

      expect(decision.chosenAgentId).toBe('a-reviewer');
      expect(decision.confidence).toBeGreaterThan(0);
      expect(
        decision.runnersUp.every((r) => agents.some((a) => a.id === r.agentId)),
      ).toBe(true);
    },
    30_000,
  );
});
