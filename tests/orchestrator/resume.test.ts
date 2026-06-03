import { MemorySaver } from '@langchain/langgraph';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, createMockAdapter } from '../../src/adapters/index.js';
import type { Artifact, ArtifactId } from '../../src/contracts/index.js';
import {
  resumeOrchestrator,
  runOrchestrator,
  workspaceResolver,
} from '../../src/orchestrator/index.js';

describe('resumeOrchestrator', () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'roundtable-resume-'));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('halts on clarify, then resumes through plan + dispatch on answer', async () => {
    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({
        scriptedEvents: [
          { type: 'text_delta', delta: 'working' },
          { type: 'done', finishReason: 'stop' },
        ],
      }),
    );
    registry.bindRole('implementer', 'mock');
    registry.bindRole('planner', 'mock');
    registry.bindRole('reviewer', 'mock');

    // Shared checkpointer across run + resume so the thread is persisted.
    const checkpointer = new MemorySaver();
    const deps = { registry, workspaces: workspaceResolver(workDir), checkpointer };

    const halted = await runOrchestrator(
      { chatId: 'chat-resume', userMessage: 'idk', threadId: 'thread-1' },
      deps,
    );

    expect(halted.stage).toBe('clarify');
    expect(halted.clarify?.questions.length).toBeGreaterThan(0);
    expect(halted.clarify?.resolved).toBe(false);

    const resumed = await resumeOrchestrator(
      {
        chatId: 'chat-resume',
        threadId: 'thread-1',
        clarifyAnswers: { scope: 'prototype' },
      },
      deps,
    );

    expect(resumed.stage).toBe('done');
    expect(resumed.clarify?.resolved).toBe(true);
    expect(resumed.clarify?.answers).toEqual({ scope: 'prototype' });
    expect(resumed.plan?.tasks.length).toBeGreaterThanOrEqual(1);
    expect(resumed.aggregate?.headline).toMatch(/Done|Partial/);
  });

  it('drains artifact events into state.artifacts and the channel survives checkpoint resume', async () => {
    const landingPage: Artifact = {
      id: 'art-landing' as ArtifactId,
      kind: 'file',
      title: 'LandingPage.tsx',
      ownerAgentId: 'implementer',
      version: 1,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    };
    const waitlistApi: Artifact = {
      id: 'art-api' as ArtifactId,
      kind: 'file',
      title: 'api/waitlist.ts',
      ownerAgentId: 'implementer',
      version: 1,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    };

    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({
        scriptedEvents: [
          { type: 'artifact', artifact: landingPage },
          { type: 'artifact', artifact: waitlistApi },
          { type: 'done', finishReason: 'stop' },
        ],
      }),
    );
    registry.bindRole('implementer', 'mock');
    registry.bindRole('planner', 'mock');
    registry.bindRole('reviewer', 'mock');

    const checkpointer = new MemorySaver();
    const deps = { registry, workspaces: workspaceResolver(workDir), checkpointer };

    const halted = await runOrchestrator(
      { chatId: 'chat-artifacts', userMessage: 'idk', threadId: 'thread-artifacts' },
      deps,
    );

    expect(halted.stage).toBe('clarify');
    expect(halted.artifacts).toEqual([]);

    const resumed = await resumeOrchestrator(
      {
        chatId: 'chat-artifacts',
        threadId: 'thread-artifacts',
        clarifyAnswers: { scope: 'prototype' },
      },
      deps,
    );

    expect(resumed.stage).toBe('done');
    expect(resumed.artifacts).toEqual([landingPage, waitlistApi]);
    expect(resumed.aggregate?.bullets).toEqual(
      expect.arrayContaining(['LandingPage.tsx', 'api/waitlist.ts']),
    );
  });

  it('keeps clarify unresolved when resume answers are incomplete', async () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter());
    registry.bindRole('implementer', 'mock');
    registry.bindRole('planner', 'mock');
    registry.bindRole('reviewer', 'mock');

    const checkpointer = new MemorySaver();
    const deps = {
      registry,
      workspaces: workspaceResolver(workDir),
      checkpointer,
      clarify: {
        async generate() {
          return [
            { id: 'scope', prompt: 'Scope?', options: [{ id: 'prototype', label: 'Prototype' }] },
            { id: 'stack', prompt: 'Stack?', options: [{ id: 'web', label: 'Web' }] },
          ];
        },
      },
    };

    await runOrchestrator(
      { chatId: 'chat-partial', userMessage: 'idk', threadId: 'thread-partial' },
      deps,
    );

    const resumed = await resumeOrchestrator(
      {
        chatId: 'chat-partial',
        threadId: 'thread-partial',
        clarifyAnswers: { scope: 'prototype' },
      },
      deps,
    );

    expect(resumed.stage).toBe('clarify');
    expect(resumed.clarify?.resolved).toBe(false);
    expect(resumed.plan).toBeUndefined();
  });
});
