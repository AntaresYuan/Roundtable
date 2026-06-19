import { z } from 'zod';
import { ArtifactIdSchema, ChatIdSchema, MissionIdSchema } from './ids.js';
import { checkpointKindForGate, explainGate } from './gate-policy.js';
import { PlanSchema, PlanTaskStatusSchema, type Plan } from './plan.js';
import {
  StageKindSchema,
  WorkflowSchema,
  type Workflow,
} from './workflow.js';
import {
  StageStatusSchema,
  WorkflowRunSchema,
  type StageRunState,
  type WorkflowRun,
} from './workflow-run.js';

export const MissionStatusSchema = z.enum([
  'draft',
  'planned',
  'running',
  'blocked',
  'completed',
  'failed',
  'canceled',
]);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

export const MissionTaskStatusSchema = z.enum([
  'pending',
  'running',
  'blocked',
  'completed',
  'failed',
  'skipped',
  'canceled',
]);
export type MissionTaskStatus = z.infer<typeof MissionTaskStatusSchema>;

export const MissionCheckpointKindSchema = z.enum([
  'clarification',
  'plan_approval',
  'user_approval',
  'handoff_acceptance',
  'reviewer_signoff',
  'test_repair',
  'final_acceptance',
  'custom',
]);
export type MissionCheckpointKind = z.infer<typeof MissionCheckpointKindSchema>;

export const MissionCheckpointStatusSchema = z.enum([
  'pending',
  'active',
  'approved',
  'rejected',
  'skipped',
]);
export type MissionCheckpointStatus = z.infer<typeof MissionCheckpointStatusSchema>;

export const MissionDecisionActionSchema = z.enum([
  'approve',
  'request_changes',
  'reject',
  'pause',
  'resume',
  'reassign',
  'request_tests',
  'accept_delivery',
]);
export type MissionDecisionAction = z.infer<typeof MissionDecisionActionSchema>;

export const MissionWorkflowRefSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.number().int().nonnegative(),
  name: z.string().min(1),
  originKind: z.enum(['builtin', 'user', 'fork']),
});
export type MissionWorkflowRef = z.infer<typeof MissionWorkflowRefSchema>;

export const MissionStageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: StageKindSchema,
  status: StageStatusSchema,
  taskIds: z.array(z.string().min(1)).default([]),
  checkpointIds: z.array(z.string().min(1)).default([]),
});
export type MissionStage = z.infer<typeof MissionStageSchema>;

export const MissionTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  assignee: z.string().min(1),
  stageId: z.string().min(1).optional(),
  status: MissionTaskStatusSchema,
  dependsOnTaskIds: z.array(z.string().min(1)).default([]),
  artifactIds: z.array(ArtifactIdSchema).default([]),
  handoffCardIds: z.array(z.string().min(1)).default([]),
});
export type MissionTask = z.infer<typeof MissionTaskSchema>;

export const MissionCheckpointSchema = z.object({
  id: z.string().min(1),
  kind: MissionCheckpointKindSchema,
  label: z.string().min(1),
  status: MissionCheckpointStatusSchema,
  stageId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  required: z.boolean().default(true),
  reason: z.string().optional(),
  decisionIds: z.array(z.string().min(1)).default([]),
});
export type MissionCheckpoint = z.infer<typeof MissionCheckpointSchema>;

export const MissionDecisionSchema = z.object({
  id: z.string().min(1),
  checkpointId: z.string().min(1).optional(),
  actorId: z.string().min(1),
  action: MissionDecisionActionSchema,
  summary: z.string().min(1),
  createdAt: z.coerce.date(),
});
export type MissionDecision = z.infer<typeof MissionDecisionSchema>;

export const MissionFinalDeliverySchema = z.object({
  status: z.enum(['not_ready', 'ready', 'accepted', 'rejected']),
  summary: z.string().optional(),
  artifactIds: z.array(ArtifactIdSchema).default([]),
  riskIds: z.array(z.string().min(1)).default([]),
});
export type MissionFinalDelivery = z.infer<typeof MissionFinalDeliverySchema>;

export const MissionSchema = z.object({
  id: MissionIdSchema,
  goal: z.string().min(1),
  status: MissionStatusSchema,
  chatId: ChatIdSchema.optional(),
  workbenchId: z.string().min(1).optional(),
  workflow: MissionWorkflowRefSchema.optional(),
  activeStageId: z.string().min(1).optional(),
  stages: z.array(MissionStageSchema),
  tasks: z.array(MissionTaskSchema),
  checkpoints: z.array(MissionCheckpointSchema).default([]),
  decisions: z.array(MissionDecisionSchema).default([]),
  artifactIds: z.array(ArtifactIdSchema).default([]),
  handoffCardIds: z.array(z.string().min(1)).default([]),
  finalDelivery: MissionFinalDeliverySchema.default({ status: 'not_ready' }),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
});
export type Mission = z.infer<typeof MissionSchema>;

export const MissionFromWorkflowRunInputSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  chatId: z.string().min(1).optional(),
  workbenchId: z.string().min(1).optional(),
  workflow: WorkflowSchema,
  workflowRun: WorkflowRunSchema,
  plan: PlanSchema.optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  handoffCardIds: z.array(z.string().min(1)).default([]),
});
export interface MissionFromWorkflowRunInput {
  id: string;
  goal: string;
  chatId?: string;
  workbenchId?: string;
  workflow: Workflow;
  workflowRun: WorkflowRun;
  plan?: Plan;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  handoffCardIds?: string[];
}

export function missionFromWorkflowRun(input: MissionFromWorkflowRunInput): Mission {
  const parsed = MissionFromWorkflowRunInputSchema.parse(input);
  const taskArtifactIds = artifactIdsByTaskId(
    parsed.workflow,
    parsed.workflowRun,
    parsed.plan,
  );
  const tasks = missionTasksFromPlan(parsed.plan, taskArtifactIds);
  const checkpoints = missionCheckpointsFromWorkflowRun(
    parsed.workflow,
    parsed.workflowRun,
  );
  const tasksByStage = groupTasksByStage(tasks);
  const checkpointsByStage = groupCheckpointsByStage(checkpoints);
  const artifactIds = uniqueArtifacts(tasks.flatMap((task) => task.artifactIds));

  return MissionSchema.parse({
    id: parsed.id,
    goal: parsed.goal,
    status: missionStatusFromWorkflowRun(parsed.workflowRun),
    ...(parsed.chatId ? { chatId: parsed.chatId } : {}),
    ...(parsed.workbenchId ? { workbenchId: parsed.workbenchId } : {}),
    workflow: {
      templateId: parsed.workflow.id,
      templateVersion: parsed.workflow.version,
      name: parsed.workflow.name,
      originKind: parsed.workflow.origin.kind,
    },
    ...(parsed.workflowRun.activeStageId
      ? { activeStageId: parsed.workflowRun.activeStageId }
      : {}),
    stages: parsed.workflow.stages.map((stage) => {
      const runState = parsed.workflowRun.stageStates[stage.id];
      return {
        id: stage.id,
        name: stage.name,
        kind: stage.kind,
        status: runState?.status ?? 'pending',
        taskIds: tasksByStage.get(stage.id) ?? [],
        checkpointIds: checkpointsByStage.get(stage.id) ?? [],
      };
    }),
    tasks,
    checkpoints,
    artifactIds,
    handoffCardIds: parsed.handoffCardIds,
    finalDelivery: {
      status: missionStatusFromWorkflowRun(parsed.workflowRun) === 'completed'
        ? 'ready'
        : 'not_ready',
      artifactIds,
    },
    createdAt: parsed.createdAt ?? new Date(),
    ...(parsed.updatedAt ? { updatedAt: parsed.updatedAt } : {}),
  });
}

function missionStatusFromWorkflowRun(run: WorkflowRun): MissionStatus {
  const states = Object.values(run.stageStates);
  if (run.pendingGate || run.pendingRecovery || states.some((state) => state.status === 'blocked')) {
    return 'blocked';
  }
  if (states.some((state) => state.status === 'failed')) return 'failed';
  if (states.length > 0 && states.every((state) => state.status === 'done')) {
    return 'completed';
  }
  if (states.some((state) => state.status === 'active')) return 'running';
  return 'planned';
}

function missionTasksFromPlan(
  plan: Plan | undefined,
  taskArtifactIds: Map<string, string[]>,
): MissionTask[] {
  if (!plan) return [];
  return plan.tasks.map((task) =>
    MissionTaskSchema.parse({
      id: task.id,
      title: task.title,
      assignee: task.assignee,
      ...(task.workflowStageId ? { stageId: task.workflowStageId } : {}),
      status: mapPlanStatus(task.status),
      dependsOnTaskIds: task.deps,
      artifactIds: taskArtifactIds.get(task.id) ?? [],
      handoffCardIds: [],
    }),
  );
}

function mapPlanStatus(status: z.infer<typeof PlanTaskStatusSchema>): MissionTaskStatus {
  if (status === 'pending') return 'pending';
  if (status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  return 'failed';
}

function missionCheckpointsFromWorkflowRun(
  workflow: Workflow,
  run: WorkflowRun,
): MissionCheckpoint[] {
  return workflow.stages.flatMap((stage) => {
    if (stage.gate.kind === 'none') return [];
    const checkpointId = `${stage.id}:gate`;
    const active = run.pendingGate?.stageId === stage.id;
    const stageState = run.stageStates[stage.id];
    const kind = checkpointKindForGate(stage.gate) ?? 'user_approval';
    // The gate's runtime reason wins; otherwise fall back to the policy's
    // plain-language explanation so a blocked Mission says what input it needs.
    const reason = stageState?.gate?.reason ?? explainGate(stage.gate);
    return [
      MissionCheckpointSchema.parse({
        id: checkpointId,
        kind,
        label: `${stage.name} — ${checkpointLabel(kind)}`,
        status: active ? 'active' : checkpointStatusFromStage(stageState),
        stageId: stage.id,
        required: true,
        decisionIds: [],
        ...(reason ? { reason } : {}),
      }),
    ];
  });
}

function checkpointLabel(kind: MissionCheckpointKind): string {
  switch (kind) {
    case 'clarification':
      return 'clarification';
    case 'plan_approval':
      return 'plan approval';
    case 'user_approval':
      return 'approval';
    case 'handoff_acceptance':
      return 'handoff acceptance';
    case 'reviewer_signoff':
      return 'reviewer sign-off';
    case 'test_repair':
      return 'test repair';
    case 'final_acceptance':
      return 'final acceptance';
    case 'custom':
      return 'checkpoint';
  }
}

function checkpointStatusFromStage(
  stageState: StageRunState | undefined,
): MissionCheckpointStatus {
  if (!stageState) return 'pending';
  if (stageState.status === 'done') return 'approved';
  if (stageState.status === 'failed') return 'rejected';
  return 'pending';
}

function artifactIdsByTaskId(
  workflow: Workflow,
  run: WorkflowRun,
  plan: Plan | undefined,
): Map<string, string[]> {
  const ids = new Map<string, string[]>();
  for (const task of plan?.tasks ?? []) {
    const stageId = task.workflowStageId;
    if (!stageId) continue;
    const stage = workflow.stages.find((candidate) => candidate.id === stageId);
    const stageRun = run.stageStates[stageId];
    if (!stage || !stageRun) continue;
    const seatIndex = task.id.startsWith(`${stageId}__`)
      ? Number.parseInt(task.id.slice(`${stageId}__`.length), 10)
      : Number.NaN;
    const seatRun = Number.isInteger(seatIndex)
      ? stageRun.seatRuns[seatIndex]
      : stageRun.seatRuns.find((candidate) => `@${candidate.agentId}` === task.assignee);
    if (seatRun?.artifactIds.length) {
      ids.set(task.id, uniqueArtifacts(seatRun.artifactIds));
    }
  }
  return ids;
}

function groupTasksByStage(tasks: MissionTask[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.stageId) continue;
    grouped.set(task.stageId, [...(grouped.get(task.stageId) ?? []), task.id]);
  }
  return grouped;
}

function groupCheckpointsByStage(
  checkpoints: MissionCheckpoint[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const checkpoint of checkpoints) {
    if (!checkpoint.stageId) continue;
    grouped.set(checkpoint.stageId, [
      ...(grouped.get(checkpoint.stageId) ?? []),
      checkpoint.id,
    ]);
  }
  return grouped;
}

function uniqueArtifacts(ids: string[]): string[] {
  return Array.from(new Set(ids));
}
