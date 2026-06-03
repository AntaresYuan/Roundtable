import { randomUUID } from 'node:crypto';
import type {
  AgentRoleId,
  Plan,
  PlanTask,
  Seat,
  Stage,
  Workflow,
} from '../../contracts/index.js';
import type { OrchestratorState } from '../state.js';

export interface Planner {
  buildPlan(state: OrchestratorState): Promise<Plan>;
}

export function workflowPlanner(): Planner {
  return {
    async buildPlan(state: OrchestratorState): Promise<Plan> {
      if (!state.workflow) {
        throw new Error('workflowPlanner called without state.workflow');
      }
      return buildPlanFromWorkflow(state.workflow);
    },
  };
}

function buildPlanFromWorkflow(workflow: Workflow): Plan {
  const tasks: PlanTask[] = [];
  let prevStageLastTaskId: string | undefined;

  for (const stage of workflow.stages) {
    if (stage.kind === 'intake') continue;

    const stageTaskIds: string[] = [];
    for (let i = 0; i < stage.seats.length; i++) {
      const seat = stage.seats[i]!;
      if (seat.ref.kind !== 'role') continue;

      const id = `${stage.id}__${i}`;
      const deps = computeDeps(stageTaskIds, prevStageLastTaskId, stage.parallelGroup);

      tasks.push({
        id,
        title: composeTaskBrief(seat, stage),
        assignee: `@${seat.ref.role}`,
        deps,
        ...(stage.parallelGroup ? { parallelGroup: stage.parallelGroup, parallel: true } : {}),
        workflowStageId: stage.id,
        user_visible: true,
        status: 'pending',
      });
      stageTaskIds.push(id);
    }

    if (stageTaskIds.length > 0) {
      prevStageLastTaskId = stageTaskIds[stageTaskIds.length - 1];
    }
  }

  return { id: randomUUID(), createdAt: new Date(), tasks };
}

function computeDeps(
  stageTaskIds: string[],
  prevStageLastTaskId: string | undefined,
  parallelGroup: string | undefined,
): string[] {
  if (parallelGroup) {
    return prevStageLastTaskId ? [prevStageLastTaskId] : [];
  }
  if (stageTaskIds.length > 0) {
    return [stageTaskIds[stageTaskIds.length - 1]!];
  }
  return prevStageLastTaskId ? [prevStageLastTaskId] : [];
}

function composeTaskBrief(seat: Seat, stage: Stage): string {
  const lines: string[] = [];
  lines.push(seat.brief?.trim() || `${stage.name} — ${stage.desc}`);
  if (seat.skills && seat.skills.length > 0) {
    lines.push(`Mounted skills: ${seat.skills.join(', ')}`);
  }
  if (seat.tools && seat.tools.length > 0) {
    lines.push(`Available tools: ${seat.tools.join(', ')}`);
  }
  return lines.join('\n\n');
}

export function rolePlanner(): Planner {
  return {
    async buildPlan(state: OrchestratorState): Promise<Plan> {
      const roles = state.intake?.suggestedRoles ?? ['implementer'];
      const tasks: PlanTask[] = roles.map((role, idx) =>
        roleToTask(role, idx, roles[idx - 1]),
      );
      return {
        id: randomUUID() as string,
        createdAt: new Date(),
        tasks,
      };
    },
  };
}

function roleToTask(
  role: AgentRoleId,
  index: number,
  prevRole: AgentRoleId | undefined,
): PlanTask {
  const id = `T${index + 1}`;
  const deps = index === 0 || !prevRole ? [] : [`T${index}`];
  return {
    id,
    title: defaultTitleForRole(role),
    assignee: `@${role}`,
    deps,
    user_visible: true,
    status: 'pending',
  };
}

function defaultTitleForRole(role: AgentRoleId): string {
  switch (role) {
    case 'architect':
      return 'Design system and contracts';
    case 'planner':
      return 'Confirm requirements and acceptance criteria';
    case 'implementer':
      return 'Implement scoped code changes';
    case 'reviewer':
      return 'Review diff and surface concerns';
    case 'fixer':
      return 'Repair targeted defect';
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

export async function runPlan(
  state: OrchestratorState,
  planner: Planner,
): Promise<OrchestratorState> {
  if (state.workflow) {
    const plan = await workflowPlanner().buildPlan(state);
    if (plan.tasks.length === 0) {
      return { ...state, stage: 'aggregate' };
    }
    return { ...state, plan, stage: 'dispatch' };
  }

  const intake = state.intake;
  if (!intake) {
    return {
      ...state,
      stage: 'aggregate',
      errors: [...state.errors, { stage: 'plan', message: 'intake missing' }],
    };
  }

  if (intake.intentType === 'control' || intake.suggestedRoles.length === 0) {
    return { ...state, stage: 'aggregate' };
  }

  const plan = await planner.buildPlan(state);
  return { ...state, plan, stage: 'dispatch' };
}
