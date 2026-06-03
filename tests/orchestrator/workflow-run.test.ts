import { MemorySaver } from '@langchain/langgraph';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, createMockAdapter } from '../../src/adapters/index.js';
import type {
  AgentEvent,
  Artifact,
  ArtifactId,
  Workflow,
} from '../../src/contracts/index.js';
import {
  resumeOrchestrator,
  runOrchestrator,
  workflowPlanner,
  workflowRunFromState,
  workspaceResolver,
} from '../../src/orchestrator/index.js';
import { initialState } from '../../src/orchestrator/state.js';

function gatedWorkflow(): Workflow {
  return {
    id: 'wf-fullstack',
    name: 'Ship a PR-ready feature',
    desc: 'Build + reviewer sign-off',
    origin: { kind: 'builtin' },
    builtin: true,
    planning: { cut: 'by_role', clarifyThreshold: 0.6, maxClarifyQuestions: 3 },
    version: 1,
    updatedAt: '2026-06-03T00:00:00Z',
    stages: [
      {
        id: 'build',
        name: 'Build',
        icon: 'wrench',
        desc: 'implement the feature',
        kind: 'work',
        seats: [
          {
            ref: { kind: 'role', role: 'implementer' },
            brief: 'prefer server components, no client JS for submit',
            skills: ['write-orchestrator-prompt'],
          },
        ],
        gate: { kind: 'none' },
      },
      {
        id: 'review',
        name: 'Review',
        icon: 'eye',
        desc: 'reviewer sign-off',
        kind: 'review',
        seats: [
          {
            ref: { kind: 'role', role: 'reviewer' },
            brief: 'flag missing client-side validation',
          },
        ],
        gate: {
          kind: 'reviewer_signoff',
          reviewer: { kind: 'role', role: 'reviewer' },
          blockOn: 'open_comments',
        },
      },
    ],
  };
}

function landingArtifact(): Artifact {
  return {
    id: 'art-landing' as ArtifactId,
    kind: 'file',
    title: 'LandingPage.tsx',
    ownerAgentId: 'implementer',
    version: 1,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };
}

describe('workflowPlanner', () => {
  it('builds one task per role seat, threads stage id + brief into the task', async () => {
    const workflow = gatedWorkflow();
    const state = { ...initialState('c1', 'build the page', workflow) };

    const plan = await workflowPlanner().buildPlan(state);

    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0]).toMatchObject({
      id: 'build__0',
      assignee: '@implementer',
      workflowStageId: 'build',
      deps: [],
    });
    expect(plan.tasks[0]!.title).toContain('prefer server components');
    expect(plan.tasks[0]!.title).toContain('write-orchestrator-prompt');
    expect(plan.tasks[1]).toMatchObject({
      id: 'review__0',
      assignee: '@reviewer',
      workflowStageId: 'review',
      deps: ['build__0'],
    });
  });

  it('skips kind:"intake" stages and kind:"user" seats', async () => {
    const workflow: Workflow = {
      ...gatedWorkflow(),
      stages: [
        {
          id: 'intake',
          name: 'Intake',
          icon: 'inbox',
          desc: 'orchestrator intake',
          kind: 'intake',
          seats: [{ ref: { kind: 'role', role: 'planner' } }],
          gate: { kind: 'none' },
        },
        {
          id: 'work',
          name: 'Work',
          icon: 'wrench',
          desc: 'human + implementer',
          kind: 'work',
          seats: [
            { ref: { kind: 'user' } },
            { ref: { kind: 'role', role: 'implementer' } },
          ],
          gate: { kind: 'none' },
        },
      ],
    };
    const state = { ...initialState('c1', 'go', workflow) };

    const plan = await workflowPlanner().buildPlan(state);

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]!.assignee).toBe('@implementer');
  });
});

describe('runOrchestrator + workflow-driven gated review', () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'roundtable-wf-'));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('pauses on the reviewer_signoff gate then resumes to done on approve', async () => {
    const events: AgentEvent[] = [
      { type: 'artifact', artifact: landingArtifact() },
      { type: 'file_change', path: 'LandingPage.tsx', kind: 'create', diff: '+content' },
      { type: 'done', finishReason: 'stop' },
    ];
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter({ scriptedEvents: events }));
    registry.bindRole('implementer', 'mock');
    registry.bindRole('reviewer', 'mock');

    const checkpointer = new MemorySaver();
    const deps = {
      registry,
      workspaces: workspaceResolver(workDir),
      checkpointer,
    };

    const workflow = gatedWorkflow();
    const halted = await runOrchestrator(
      {
        chatId: 'chat-wf',
        userMessage: 'build a waitlist landing page that captures email',
        threadId: 'thread-wf',
        workflow,
      },
      deps,
    );

    expect(halted.stage).toBe('gate');
    expect(halted.pendingGate?.stageId).toBe('review');
    expect(halted.pendingGate?.gate.kind).toBe('reviewer_signoff');

    const haltedRun = workflowRunFromState(halted);
    expect(haltedRun?.activeStageId).toBe('review');
    expect(haltedRun?.stageStates['build']?.status).toBe('done');
    expect(haltedRun?.stageStates['review']?.status).toBe('blocked');
    expect(haltedRun?.pendingGate?.stageId).toBe('review');

    const resumed = await resumeOrchestrator(
      {
        chatId: 'chat-wf',
        threadId: 'thread-wf',
        gate: { stageId: 'review', decision: 'approve' },
      },
      deps,
    );

    expect(resumed.stage).toBe('done');
    expect(resumed.gateDecisions['review']).toBe('approve');
    expect(resumed.pendingGate).toBeUndefined();

    const finalRun = workflowRunFromState(resumed);
    expect(finalRun?.stageStates['review']?.status).toBe('done');
  });
});

describe('handoffOverride merge', () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'roundtable-override-'));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('stage.handoffOverride wins over the generated taskBrief and userIntent', async () => {
    const workflow: Workflow = {
      ...gatedWorkflow(),
      stages: [
        {
          id: 'build',
          name: 'Build',
          icon: 'wrench',
          desc: 'implement',
          kind: 'work',
          seats: [{ ref: { kind: 'role', role: 'implementer' }, brief: 'original brief' }],
          gate: { kind: 'none' },
          handoffOverride: {
            taskBrief: 'OVERRIDDEN brief',
            userIntent: 'OVERRIDDEN intent',
          },
        },
      ],
    };

    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter({
        scriptedEvents: [{ type: 'done', finishReason: 'stop' }],
      }),
    );
    registry.bindRole('implementer', 'mock');

    const result = await runOrchestrator(
      {
        chatId: 'chat-override',
        userMessage: 'do the thing',
        threadId: 'thread-override',
        workflow,
      },
      { registry, workspaces: workspaceResolver(workDir) },
    );

    const card = result.handoffCards[0]!;
    expect(card.taskBrief).toBe('OVERRIDDEN brief');
    expect(card.userIntent).toBe('OVERRIDDEN intent');
  });
});
