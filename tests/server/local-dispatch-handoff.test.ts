import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchApprovedLocalTurn } from '../../src/server/local-dispatch.js';
import { saveLocalTurn } from '../../src/server/local-turn-store.js';
import type { LocalTurn } from '../../src/server/local-turn-store.js';

// Issue #135: a live dispatch must append a hand-off audit line to
// ai-logs/handoffs.jsonl (the file the evaluator opens live), within ~2s, with
// the ts/from/to/user_intent/summary fields.
describe('dispatchApprovedLocalTurn → handoff log', () => {
  let rootDir: string;
  let handoffPath: string;
  const saved: Record<string, string | undefined> = {};

  const setEnv = (key: string, value: string) => {
    saved[key] = process.env[key];
    process.env[key] = value;
  };

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'roundtable-handoff-dispatch-'));
    handoffPath = join(rootDir, 'ai-logs', 'handoffs.jsonl');
    setEnv('ROUNDTABLE_TURN_STORE', 'local');
    setEnv('ROUNDTABLE_LOCAL_ROOT', rootDir);
    setEnv('ROUNDTABLE_LOCAL_TURN_STORE', join(rootDir, 'local-turns.json'));
    setEnv('ROUNDTABLE_HANDOFF_LOG', handoffPath);
    setEnv('ROUNDTABLE_LOCAL_AGENT_LLM', '0');
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(rootDir, { recursive: true, force: true });
  });

  it('appends an audit line with the required fields within 2s', async () => {
    await saveLocalTurn(approvedTurn('turn-handoff-1'));

    const start = Date.now();
    const result = await dispatchApprovedLocalTurn('turn-handoff-1', {
      agentAdapter: 'local-dispatch',
    });
    const elapsed = Date.now() - start;

    expect(result.dispatchStatus).toBe('completed');
    expect(elapsed).toBeLessThan(2000);

    const lines = (await readFile(handoffPath, 'utf8')).trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry).toMatchObject({
      from: 'orchestrator',
      to: 'implementer',
      user_intent: 'Build a login page',
      summary: expect.any(String),
    });
    expect(typeof entry.ts).toBe('string');
    expect(Number.isNaN(Date.parse(entry.ts))).toBe(false);
  });
});

function approvedTurn(id: string): LocalTurn {
  return {
    id,
    message: 'Build a login page',
    status: 'done',
    createdAt: new Date('2026-06-08T10:00:00Z').toISOString(),
    needsApproval: false,
    approvalStatus: 'approved',
    approvedAt: new Date('2026-06-08T10:00:05Z').toISOString(),
    intake: {
      intentType: 'build',
      clarity: 'clear',
      ambiguityScore: 0,
      complexity: 'single_agent',
      risk: 'low',
      suggestedRoles: ['implementer'],
      userVisibleSummary: 'Build a login page',
    },
    plan: {
      id: `${id}-plan`,
      createdAt: new Date('2026-06-08T10:00:01Z'),
      tasks: [
        {
          id: 'T1',
          title: 'Build a login page',
          assignee: '@implementer',
          deps: [],
          user_visible: true,
          status: 'pending',
        },
      ],
    },
  };
}
