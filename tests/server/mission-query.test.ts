import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTONOMY_POLICY_PRESETS,
  type Plan,
  type Workflow,
  type WorkflowRun,
} from '../../src/contracts/index.js';
import type { LocalTurn } from '../../src/server/local-turn-store.js';
import { saveLocalTurn } from '../../src/server/local-turn-store.js';
import {
  latestMissionTurn,
  loadMissionForChat,
  missionFromTurn,
} from '../../src/server/mission-query.js';
import { GET as missionGet } from '../../src/app/api/orchestrator/mission/route.js';

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
          { agentId: 'implementer', status: 'completed', artifactIds: ['art-invite-api'] },
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

function missionTurn(id: string, createdAt: string): LocalTurn {
  return {
    id,
    localChatId: 'local-chat-1',
    message: 'Add team invitations',
    status: 'done',
    createdAt,
    workflow: workflow(),
    workflowRun: workflowRun(),
    plan: plan(),
  };
}

function planOnlyTurn(id: string, createdAt: string): LocalTurn {
  return {
    id,
    localChatId: 'local-chat-1',
    message: 'A turn that never drove a workflow run',
    status: 'done',
    createdAt,
    plan: plan(),
  };
}

describe.sequential('mission read path', () => {
  let rootDir: string;
  let previousRoot: string | undefined;
  let previousStore: string | undefined;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'roundtable-mission-query-'));
    previousRoot = process.env['ROUNDTABLE_LOCAL_ROOT'];
    previousStore = process.env['ROUNDTABLE_LOCAL_TURN_STORE'];
    process.env['ROUNDTABLE_LOCAL_ROOT'] = join(rootDir, '.roundtable');
    process.env['ROUNDTABLE_LOCAL_TURN_STORE'] = join(rootDir, 'local-turns.json');
  });

  afterEach(async () => {
    restoreEnv('ROUNDTABLE_LOCAL_ROOT', previousRoot);
    restoreEnv('ROUNDTABLE_LOCAL_TURN_STORE', previousStore);
    await rm(rootDir, { recursive: true, force: true });
  });

  it('projects a turn into a mission with goal, stages, tasks, and checkpoints', () => {
    const mission = missionFromTurn(missionTurn('turn-1', '2026-06-19T02:00:00Z'), 'local-chat-1');

    expect(mission).not.toBeNull();
    expect(mission).toMatchObject({
      id: 'mission-turn-1',
      goal: 'Add team invitations',
      status: 'blocked',
      chatId: 'local-chat-1',
      activeStageId: 'review',
    });
    expect(mission?.tasks[0]).toMatchObject({ id: 'build__0', artifactIds: ['art-invite-api'] });
    expect(mission?.checkpoints[0]).toMatchObject({ id: 'review:gate', kind: 'reviewer_signoff' });
  });

  it('returns null for a turn that never ran a workflow', () => {
    expect(missionFromTurn(planOnlyTurn('turn-x', '2026-06-19T02:00:00Z'))).toBeNull();
  });

  it('picks the newest workflow-driven turn as the active mission', () => {
    const turns = [
      missionTurn('turn-new', '2026-06-19T05:00:00Z'),
      planOnlyTurn('turn-noise', '2026-06-19T04:00:00Z'),
      missionTurn('turn-old', '2026-06-19T01:00:00Z'),
    ];
    expect(latestMissionTurn(turns)?.id).toBe('turn-new');
  });

  it('loads the active mission for a chat from the turn store', async () => {
    await saveLocalTurn(missionTurn('turn-old', '2026-06-19T01:00:00Z'));
    await saveLocalTurn(missionTurn('turn-new', '2026-06-19T05:00:00Z'));

    const mission = await loadMissionForChat('local-chat-1');
    expect(mission?.id).toBe('mission-turn-new');
    expect(mission?.goal).toBe('Add team invitations');
  });

  it('returns null mission for a chat with no workflow-driven turns', async () => {
    await saveLocalTurn(planOnlyTurn('turn-noise', '2026-06-19T01:00:00Z'));
    expect(await loadMissionForChat('local-chat-1')).toBeNull();
  });

  it('serves the projected mission over the read API route', async () => {
    await saveLocalTurn(missionTurn('turn-1', '2026-06-19T02:00:00Z'));

    const response = await missionGet(
      new Request('http://roundtable.test/api/orchestrator/mission?chatId=local-chat-1'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mission).toMatchObject({
      id: 'mission-turn-1',
      goal: 'Add team invitations',
      status: 'blocked',
      activeStageId: 'review',
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
