import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, createMockAdapter } from '../../src/adapters/index.js';
import {
  inMemorySelectorTelemetry,
  runOrchestrator,
  workspaceResolver,
} from '../../src/orchestrator/index.js';
import type {
  AgentDescription,
  AgentId,
  SelectorDecision,
} from '../../src/contracts/index.js';
import type { SpeakerSelector } from '../../src/orchestrator/nodes/selector.js';

function agent(
  id: string,
  displayName: string,
  role: AgentDescription['role'],
  capabilities: string[] = [],
): AgentDescription {
  return {
    id: id as AgentId,
    displayName,
    role,
    description: `${displayName} (${role})`,
    capabilities,
  };
}

function scripted(decision: SelectorDecision): SpeakerSelector {
  return { async select() { return decision; } };
}

describe('selector → graph routing (#63)', () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'roundtable-selector-graph-'));
  });
  afterEach(async () => rm(workDir, { recursive: true, force: true }));

  function deps(selectorSpec?: SpeakerSelector) {
    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({
        scriptedEvents: [
          { type: 'text_delta', delta: 'on it' },
          { type: 'done', finishReason: 'stop' },
        ],
      }),
    );
    registry.bindRole('planner', 'mock');
    registry.bindRole('implementer', 'mock');
    registry.bindRole('reviewer', 'mock');
    return {
      registry,
      workspaces: workspaceResolver(workDir),
      ...(selectorSpec
        ? {
            selectSpeaker: {
              selector: selectorSpec,
              telemetry: inMemorySelectorTelemetry(),
            },
          }
        : {}),
    };
  }

  it('high-confidence pick: skips intake/plan, dispatches straight to the chosen role', async () => {
    const agents = [
      agent('a-fe', 'frontend', 'implementer', ['react']),
      agent('a-be', 'backend', 'reviewer', ['api']),
    ];
    const decision: SelectorDecision = {
      chosenAgentId: 'a-fe' as AgentId,
      confidence: 0.92,
      reasoning: 'react specialist',
      runnersUp: [],
    };

    const state = await runOrchestrator(
      {
        chatId: 'chat-clear',
        userMessage: 'add a react component',
        agents,
      },
      deps(scripted(decision)),
    );

    expect(state.selector?.chosenAgentId).toBe('a-fe');
    expect(state.intake).toBeUndefined();
    expect(state.plan?.tasks).toHaveLength(1);
    expect(state.plan?.tasks[0]?.assignee).toBe('implementer');
    expect(state.dispatch).toHaveLength(1);
    expect(state.dispatch[0]?.status).toBe('completed');
  });

  it('low-confidence in a ≥4-agent room: graph halts at clarify with the selector question', async () => {
    const agents = [
      agent('a1', 'frontend', 'implementer'),
      agent('a2', 'backend', 'implementer'),
      agent('a3', 'design', 'architect'),
      agent('a4', 'tester', 'reviewer'),
    ];
    const decision: SelectorDecision = {
      chosenAgentId: 'a1' as AgentId,
      confidence: 0.3,
      reasoning: 'tied keyword',
      runnersUp: [{ agentId: 'a2' as AgentId, confidence: 0.25 }],
    };

    const state = await runOrchestrator(
      {
        chatId: 'chat-ambig',
        userMessage: 'do something with the thing',
        agents,
      },
      deps(scripted(decision)),
    );

    expect(state.stage).toBe('clarify');
    expect(state.selector?.chosenAgentId).toBe('a1');
    expect(state.clarify?.questions[0]?.id).toBe('selector_speaker');
    const optionIds = state.clarify?.questions[0]?.options.map((o) => o.id) ?? [];
    expect(optionIds).toContain('a1');
    expect(optionIds).toContain('a2');
    expect(state.dispatch).toEqual([]);
  });

  it('@mention in user message: bypasses selector, falls through to existing intake/plan flow', async () => {
    const agents = [
      agent('a-fe', 'frontend', 'implementer'),
      agent('a-be', 'backend', 'reviewer'),
    ];

    const state = await runOrchestrator(
      {
        chatId: 'chat-mention',
        userMessage: '@implementer ship the login button',
        agents,
      },
      deps(),
    );

    // No selector decision recorded — selector node was skipped because of the @mention.
    expect(state.selector).toBeUndefined();
    // The existing intake → plan → dispatch flow ran instead.
    expect(state.intake).toBeDefined();
  });

  it('zero or one agent: behavior is unchanged from the single-chat / PM flow', async () => {
    const state = await runOrchestrator(
      { chatId: 'chat-solo', userMessage: 'build a waitlist page' },
      deps(),
    );
    expect(state.selector).toBeUndefined();
    expect(state.intake).toBeDefined();
  });
});
