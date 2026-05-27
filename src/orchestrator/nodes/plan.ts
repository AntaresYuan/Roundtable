import { randomUUID } from 'node:crypto';
import type { AgentRoleId, Plan, PlanTask } from '../../contracts/index.js';
import type { OrchestratorState } from '../state.js';

export interface Planner {
  buildPlan(state: OrchestratorState): Promise<Plan>;
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
