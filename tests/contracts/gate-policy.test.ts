import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_POLICY_PRESETS,
  GATE_POLICY,
  allowedGateActions,
  canAdvancePastGate,
  checkpointKindForGate,
  explainGate,
  followUpTaskForRejection,
  gateNeedsUser,
  isGateActionAllowed,
  missionFromWorkflowRun,
  MissionTaskSchema,
  type Gate,
  type Workflow,
  type WorkflowRun,
} from '../../src/contracts/index.js';

describe('gate policy', () => {
  it('covers every enforced gate kind', () => {
    const kinds: Exclude<Gate['kind'], 'none'>[] = [
      'user_approval',
      'clarification',
      'plan_approval',
      'api_contract_approval',
      'handoff_acceptance',
      'test_repair',
      'reviewer_signoff',
      'final_acceptance',
    ];
    for (const kind of kinds) {
      expect(GATE_POLICY[kind].actions.length).toBeGreaterThan(0);
      expect(GATE_POLICY[kind].explain.length).toBeGreaterThan(0);
    }
  });

  it('treats `none` as needing no user and exposing no actions', () => {
    const none: Gate = { kind: 'none' };
    expect(gateNeedsUser(none)).toBe(false);
    expect(allowedGateActions(none)).toEqual([]);
    expect(checkpointKindForGate(none)).toBeUndefined();
    expect(explainGate(none)).toBeUndefined();
  });

  it('maps gate kinds to mission checkpoint kinds', () => {
    expect(checkpointKindForGate({ kind: 'plan_approval' })).toBe('plan_approval');
    expect(checkpointKindForGate({ kind: 'api_contract_approval' })).toBe('user_approval');
    expect(checkpointKindForGate({ kind: 'final_acceptance' })).toBe('final_acceptance');
  });

  it('prefers an explicit gate prompt over the policy default', () => {
    expect(explainGate({ kind: 'plan_approval' })).toBe(
      'Approve the plan, or ask for smaller tasks or changes.',
    );
    expect(explainGate({ kind: 'plan_approval', prompt: 'Approve the auth plan' })).toBe(
      'Approve the auth plan',
    );
  });

  it('validates allowed actions per gate', () => {
    expect(isGateActionAllowed({ kind: 'test_repair' }, 'request_tests')).toBe(true);
    expect(isGateActionAllowed({ kind: 'test_repair' }, 'accept_delivery')).toBe(false);
    expect(isGateActionAllowed({ kind: 'final_acceptance' }, 'accept_delivery')).toBe(true);
  });

  it('only advances on an approving or accepting decision', () => {
    expect(canAdvancePastGate(['request_changes'])).toBe(false);
    expect(canAdvancePastGate(['reject', 'approve'])).toBe(true);
    expect(canAdvancePastGate(['accept_delivery'])).toBe(true);
    expect(canAdvancePastGate([])).toBe(false);
  });
});

describe('followUpTaskForRejection', () => {
  const original = MissionTaskSchema.parse({
    id: 'build__0',
    title: 'Implement invite flow',
    assignee: '@implementer',
    status: 'completed',
    dependsOnTaskIds: ['plan__0'],
    artifactIds: ['art-invite-api'],
    handoffCardIds: ['card-1'],
  });

  it('creates a new pending task without mutating the original', () => {
    const followUp = followUpTaskForRejection(original, { reason: 'reviewer rejected' });

    expect(followUp.id).toBe('build__0__rework');
    expect(followUp.status).toBe('pending');
    expect(followUp.title).toBe('Rework: Implement invite flow');
    expect(followUp.dependsOnTaskIds).toContain('build__0');
    expect(followUp.artifactIds).toEqual([]);
    // Original is untouched.
    expect(original.status).toBe('completed');
    expect(original.artifactIds).toEqual(['art-invite-api']);
  });
});

describe('mission projection surfaces gate checkpoints', () => {
  function workflow(gate: Gate): Workflow {
    return {
      id: 'wf', name: 'WF', desc: 'd', origin: { kind: 'builtin' }, builtin: true,
      planning: { cut: 'by_role', clarifyThreshold: 0.5, maxClarifyQuestions: 2 },
      version: 1, updatedAt: '2026-06-19T00:00:00Z',
      stages: [
        { id: 'plan', name: 'Plan', icon: 'layers', desc: 'plan', kind: 'plan',
          seats: [{ ref: { kind: 'role', role: 'architect' } }], gate },
      ],
    };
  }
  function run(): WorkflowRun {
    return {
      specId: 'wf', specVersion: 1,
      autonomyPolicy: AUTONOMY_POLICY_PRESETS.ask_every_time, autonomyDecisions: [],
      stageStates: { plan: { status: 'blocked', seatRuns: [], gate: { open: true } } },
      activeStageId: 'plan',
      pendingGate: { stageId: 'plan', gate: { kind: 'plan_approval' } },
      failureRecoveryCards: [], depEdges: [],
    };
  }

  it('maps a plan_approval gate to a plan_approval checkpoint with an explanation', () => {
    const mission = missionFromWorkflowRun({
      id: 'mission-1', goal: 'Ship feature', workflow: workflow({ kind: 'plan_approval' }),
      workflowRun: run(), createdAt: '2026-06-19T00:00:00Z',
    });

    expect(mission.checkpoints[0]).toMatchObject({
      id: 'plan:gate',
      kind: 'plan_approval',
      status: 'active',
      reason: 'Approve the plan, or ask for smaller tasks or changes.',
    });
    expect(mission.status).toBe('blocked');
  });
});
