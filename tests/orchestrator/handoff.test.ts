import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanTask } from '../../src/contracts/index.js';
import {
  buildHandoffSystemPrompt,
  fileHandoffLog,
  generateHandoffCard,
  initialState,
} from '../../src/orchestrator/index.js';
import type { HandoffModelClient } from '../../src/orchestrator/handoff.js';
import type { OrchestratorState } from '../../src/orchestrator/state.js';

describe('generateHandoffCard', () => {
  const state: OrchestratorState = {
    ...initialState('chat-1', 'Build a waitlist page with CSV export.'),
    intake: {
      intentType: 'build',
      clarity: 'clear',
      ambiguityScore: 0,
      complexity: 'multi_agent',
      risk: 'low',
      suggestedRoles: ['implementer', 'reviewer'],
      userVisibleSummary: 'Build a waitlist page with CSV export.',
    },
  };
  const task: PlanTask = {
    id: 'T1',
    title: 'Implement scoped code changes',
    assignee: '@implementer',
    deps: [],
    user_visible: true,
    status: 'pending',
  };

  it('builds a valid fallback card with capped pinned messages', async () => {
    const card = await generateHandoffCard({
      state,
      task,
      role: 'implementer',
      pinnedMessages: Array.from({ length: 12 }, (_, i) => ({
        id: `p${i}`,
        content: `pin ${i}`,
        pinnedBy: 'user-1',
      })),
    });

    expect(card.to).toBe('implementer');
    expect(card.taskBrief).toBe(task.title);
    expect(card.pinnedMessages).toHaveLength(10);
    expect(card.fullHistoryRef).toBe('chat:chat-1');
  });

  it('retries once and falls back when the model returns invalid output', async () => {
    let calls = 0;
    const modelClient: HandoffModelClient = {
      async generate() {
        calls += 1;
        return { pinnedMessages: Array.from({ length: 11 }, () => ({ id: 'x' })) };
      },
    };

    const card = await generateHandoffCard(
      { state, task, role: 'implementer' },
      { modelClient },
    );

    expect(calls).toBe(2);
    expect(card.taskBrief).toBe(task.title);
  });

  it('keeps generated system prompts under the guardrail', async () => {
    const card = await generateHandoffCard({ state, task, role: 'implementer' });
    const prompt = buildHandoffSystemPrompt(card);

    expect(prompt.length).toBeLessThan(32_000);
    expect(prompt).toContain('Implement scoped code changes');
  });
});

describe('fileHandoffLog', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'roundtable-handoff-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('writes one jsonl summary line per card', async () => {
    const path = join(workDir, 'handoffs.jsonl');
    const log = fileHandoffLog(path);
    const state = initialState('chat-2', 'Review the diff');
    const task: PlanTask = {
      id: 'T1',
      title: 'Review diff and surface concerns',
      assignee: '@reviewer',
      deps: [],
      user_visible: true,
      status: 'pending',
    };
    const card = await generateHandoffCard({ state, task, role: 'reviewer' });

    await log.append(card);

    const [line] = (await readFile(path, 'utf8')).trim().split('\n');
    expect(JSON.parse(line ?? '{}')).toMatchObject({
      card_id: card.id,
      from: 'orchestrator',
      to: 'reviewer',
      user_intent: 'Review the diff',
      summary: 'Review diff and surface concerns',
    });
  });
});
