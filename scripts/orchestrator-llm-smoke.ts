import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdapterRegistry, createMockAdapter } from '../src/adapters/index.js';
import {
  defaultOrchestratorModel,
  llmIntake,
  llmPlanner,
  orchestratorModelConfig,
  requireOrchestratorKey,
  runOrchestrator,
  workspaceResolver,
} from '../src/orchestrator/index.js';
import type { IntakeClassifier } from '../src/orchestrator/nodes/intake.js';
import type { Planner } from '../src/orchestrator/nodes/plan.js';

loadDotEnvLocal();
requireOrchestratorKey();

const config = orchestratorModelConfig();
const workDir = await mkdtemp(join(tmpdir(), 'roundtable-orch-llm-smoke-'));
let intakeError: unknown;
let plannerError: unknown;

const strictIntakeFallback: IntakeClassifier = {
  async classify() {
    throw new Error(
      `live LLM intake failed before producing valid structured output: ${errorMessage(intakeError)}`,
    );
  },
};

const strictPlannerFallback: Planner = {
  async buildPlan() {
    throw new Error(
      `live LLM planner failed before producing valid structured output: ${errorMessage(plannerError)}`,
    );
  },
};

try {
  const registry = new AdapterRegistry();
  const mockAgent = createMockAdapter({
    id: 'mock-live-agent',
    displayName: 'Mock Live Agent',
    scriptedEvents: [
      {
        type: 'file_change',
        path: 'src/app/page.tsx',
        kind: 'edit',
        diff: '+ export default function Page() { return <main>AI smoke</main>; }',
      },
      { type: 'done', finishReason: 'stop' },
    ],
  });

  registry.register(mockAgent);
  for (const role of ['architect', 'planner', 'implementer', 'reviewer', 'fixer'] as const) {
    registry.bindRole(role, mockAgent.id);
  }

  const model = defaultOrchestratorModel();
  const state = await runOrchestrator(
    {
      chatId: 'live-smoke-chat',
      userMessage:
        'Build a small waitlist landing page and include a reviewer pass. Keep the plan concise.',
    },
    {
      registry,
      workspaces: workspaceResolver(workDir),
      intake: llmIntake({
        model,
        fallback: strictIntakeFallback,
        onError(error) {
          intakeError = error;
        },
      }),
      planner: llmPlanner({
        model,
        fallback: strictPlannerFallback,
        onError(error) {
          plannerError = error;
        },
      }),
    },
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        provider: config.provider,
        model: config.model,
        stage: state.stage,
        intake: state.intake,
        tasks: state.plan?.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          assignee: task.assignee,
          deps: task.deps,
          parallel: task.parallel ?? false,
          status: task.status,
        })),
        dispatchStatuses: state.dispatch.map((record) => ({
          taskId: record.taskId,
          status: record.status,
          events: record.events.map((event) => event.type),
        })),
        aggregate: state.aggregate?.headline,
        errors: state.errors,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(workDir, { recursive: true, force: true });
}

function loadDotEnvLocal(): void {
  for (const filename of ['.env.local', '.env']) {
    const path = join(process.cwd(), filename);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = unquoteEnvValue(rawValue ?? '');
    }
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return sanitizeSecret(error.message);
  if (typeof error === 'string') return sanitizeSecret(error);
  return 'unknown provider error';
}

function sanitizeSecret(message: string): string {
  return message
    .replace(/\bsk-\S+/g, 'sk-[redacted]')
    .replace(/\bk-cp-\S+/g, 'k-cp-[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, 'jwt-[redacted]');
}
