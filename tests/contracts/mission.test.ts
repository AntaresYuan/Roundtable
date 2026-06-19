import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_POLICY_PRESETS,
  missionFromWorkflowRun,
  MissionSchema,
  type Plan,
  type Workflow,
  type WorkflowRun,
} from '../../src/contracts/index.js';

function workflow(): Workflow {
  return {
    id: 'wf-feature-builder',
    name: 'Feature Builder',
    desc: 'Turn a vague request into a reviewed implementation.',
    origin: { kind: 'builtin' },
    builtin: true,
    planning: { cut: 'by_role', clarifyThreshold: 0.6, maxClarifyQuestions: 3 },
    version: 1,
    updatedAt: '2026-06-19T00:00:00Z',
    stages: [
      {
        id: 'build',
        name: 'Build',
        icon: 'wrench',
        desc: 'Implement the feature.',
        kind: 'work',
        seats: [{ ref: { kind: 'role', role: 'implementer' } }],
        gate: { kind: 'none' },
      },
      {
        id: 'review',
        name: 'Review',
        icon: 'eye',
        desc: 'Check the deliverable.',
        kind: 'review',
        seats: [{ ref: { kind: 'role', role: 'reviewer' } }],
        gate: {
          kind: 'reviewer_signoff',
          reviewer: { kind: 'role', role: 'reviewer' },
          blockOn: 'open_comments',
        },
      },
    ],
  };
}

function plan(): Plan {
  return {
    id: 'plan-1',
    createdAt: new Date('2026-06-19T01:00:00Z'),
    tasks: [
      {
        id: 'build__0',
        title: 'Implement invitation flow',
        assignee: '@implementer',
        deps: [],
        workflowStageId: 'build',
        status: 'completed',
        user_visible: true,
      },
      {
        id: 'review__0',
        title: 'Review invitation flow',
        assignee: '@reviewer',
        deps: ['build__0'],
        workflowStageId: 'review',
        status: 'pending',
        user_visible: true,
      },
    ],
  };
}

function workflowRun(): WorkflowRun {
  return {
    specId: 'wf-feature-builder',
    specVersion: 1,
    autonomyPolicy: AUTONOMY_POLICY_PRESETS.ask_every_time,
    autonomyDecisions: [],
    stageStates: {
      build: {
        status: 'done',
        seatRuns: [
          {
            agentId: 'implementer',
            status: 'completed',
            artifactIds: ['art-invite-api'],
          },
        ],
      },
      review: {
        status: 'blocked',
        seatRuns: [{ agentId: 'reviewer', status: 'pending', artifactIds: [] }],
        gate: { open: true, reason: 'reviewer_signoff' },
      },
    },
    activeStageId: 'review',
    pendingGate: {
      stageId: 'review',
      gate: {
        kind: 'reviewer_signoff',
        reviewer: { kind: 'role', role: 'reviewer' },
        blockOn: 'open_comments',
      },
    },
    failureRecoveryCards: [],
    depEdges: [],
  };
}

describe('MissionSchema', () => {
  it('parses a minimal mission record', () => {
    const mission = MissionSchema.parse({
      id: 'mission-1',
      goal: 'Add team invitations',
      status: 'planned',
      stages: [],
      tasks: [],
      createdAt: '2026-06-19T00:00:00Z',
    });

    expect(mission.id).toBe('mission-1');
    expect(mission.finalDelivery.status).toBe('not_ready');
  });

  it('projects an existing workflow run into a mission', () => {
    const mission = missionFromWorkflowRun({
      id: 'mission-1',
      goal: 'Add team invitations',
      chatId: 'chat-1',
      workflow: workflow(),
      workflowRun: workflowRun(),
      plan: plan(),
      createdAt: '2026-06-19T00:00:00Z',
    });

    expect(mission.status).toBe('blocked');
    expect(mission.activeStageId).toBe('review');
    expect(mission.workflow).toMatchObject({
      templateId: 'wf-feature-builder',
      templateVersion: 1,
      name: 'Feature Builder',
    });
    expect(mission.stages).toEqual([
      expect.objectContaining({
        id: 'build',
        status: 'done',
        taskIds: ['build__0'],
      }),
      expect.objectContaining({
        id: 'review',
        status: 'blocked',
        taskIds: ['review__0'],
        checkpointIds: ['review:gate'],
      }),
    ]);
    expect(mission.tasks[0]).toMatchObject({
      id: 'build__0',
      status: 'completed',
      artifactIds: ['art-invite-api'],
    });
    expect(mission.checkpoints[0]).toMatchObject({
      id: 'review:gate',
      kind: 'reviewer_signoff',
      status: 'active',
      stageId: 'review',
    });
    expect(mission.finalDelivery.status).toBe('not_ready');
  });

  it('marks final delivery ready when every stage is done', () => {
    const completedRun: WorkflowRun = {
      ...workflowRun(),
      pendingGate: undefined,
      activeStageId: undefined,
      stageStates: {
        build: workflowRun().stageStates.build!,
        review: {
          status: 'done',
          seatRuns: [{ agentId: 'reviewer', status: 'completed', artifactIds: [] }],
          gate: { open: false },
        },
      },
    };

    const mission = missionFromWorkflowRun({
      id: 'mission-1',
      goal: 'Add team invitations',
      workflow: workflow(),
      workflowRun: completedRun,
      plan: plan(),
      createdAt: '2026-06-19T00:00:00Z',
    });

    expect(mission.status).toBe('completed');
    expect(mission.finalDelivery.status).toBe('ready');
  });
});
