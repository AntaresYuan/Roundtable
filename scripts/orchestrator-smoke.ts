import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdapterRegistry, createMockAdapter } from '../src/adapters/index.js';
import { runOrchestrator, workspaceResolver } from '../src/orchestrator/index.js';

const workDir = await mkdtemp(join(tmpdir(), 'roundtable-orch-smoke-'));

try {
  const registry = new AdapterRegistry();
  registry.register(
    createMockAdapter({
      id: 'mock-planner',
      displayName: 'Mock Planner',
      scriptedEvents: [
        { type: 'text_delta', delta: 'Plan ready.' },
        { type: 'done', finishReason: 'stop' },
      ],
    }),
  );
  registry.register(
    createMockAdapter({
      id: 'mock-implementer',
      displayName: 'Mock Implementer',
      scriptedEvents: [
        {
          type: 'file_change',
          path: 'src/app/page.tsx',
          kind: 'create',
          diff: '+ export default function Page() { return null; }',
        },
        { type: 'done', finishReason: 'stop' },
      ],
    }),
  );
  registry.register(
    createMockAdapter({
      id: 'mock-reviewer',
      displayName: 'Mock Reviewer',
      scriptedEvents: [
        { type: 'text_delta', delta: 'Review complete.' },
        { type: 'done', finishReason: 'stop' },
      ],
    }),
  );

  registry.bindRole('planner', 'mock-planner');
  registry.bindRole('implementer', 'mock-implementer');
  registry.bindRole('reviewer', 'mock-reviewer');

  // NOTE (spec 100 / #119): real production callers should pass
  // `skillProposer: llmSkillProposer()` so the PM emits propose_skill events
  // at aggregate. This smoke script intentionally skips it (mock adapters
  // don't produce meaningful patterns to propose, and we don't want to
  // require an Anthropic API key for smoke tests).
  const state = await runOrchestrator(
    {
      chatId: 'smoke-chat',
      userMessage: 'Build a waitlist landing page with CSV export.',
    },
    { registry, workspaces: workspaceResolver(workDir) },
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        stage: state.stage,
        tasks: state.plan?.tasks.map((task) => ({
          id: task.id,
          assignee: task.assignee,
          status: task.status,
        })),
        dispatchStatuses: state.dispatch.map((record) => ({
          taskId: record.taskId,
          status: record.status,
          events: record.events.map((event) => event.type),
        })),
        aggregate: state.aggregate?.headline,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(workDir, { recursive: true, force: true });
}
