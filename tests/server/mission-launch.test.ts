import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as turnPost } from '../../src/app/api/orchestrator/turn/route.js';
import { loadMissionForChat } from '../../src/server/mission-query.js';

const KEY_VARS = [
  'DEEPSEEK_API_KEY',
  'MINIMAX_API_KEY',
  'VOLCANO_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
];

describe.sequential('mission launch from a workflow template', () => {
  let rootDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'roundtable-mission-launch-'));
    saved['ROUNDTABLE_LOCAL_ROOT'] = process.env['ROUNDTABLE_LOCAL_ROOT'];
    saved['ROUNDTABLE_LOCAL_TURN_STORE'] = process.env['ROUNDTABLE_LOCAL_TURN_STORE'];
    process.env['ROUNDTABLE_LOCAL_ROOT'] = join(rootDir, '.roundtable');
    process.env['ROUNDTABLE_LOCAL_TURN_STORE'] = join(rootDir, 'local-turns.json');
    // Force the deterministic heuristic path so the test never hits a network model.
    for (const key of KEY_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(rootDir, { recursive: true, force: true });
  });

  it('drives a turn from the template workflow and projects a Mission', async () => {
    const chatId = 'local-mission-launch-1';
    const res = await turnPost(
      new Request('http://roundtable.test/api/orchestrator/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Add team invitations',
          chatId,
          workflowTemplateId: 'feature-builder',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.workflow?.id).toBe('feature-builder');
    expect(body.workflowRun).toBeDefined();

    const mission = await loadMissionForChat(chatId);
    expect(mission).not.toBeNull();
    expect(mission?.goal).toBe('Add team invitations');
    expect(mission?.workflow?.templateId).toBe('feature-builder');
    expect(mission?.stages.map((s) => s.id)).toContain('clarify');
    // The flagship's gated stages surface as checkpoints, each with a
    // plain-language explanation of what the user must do.
    expect((mission?.checkpoints.length ?? 0)).toBeGreaterThan(0);
    expect(mission?.checkpoints.every((c) => !!c.reason)).toBe(true);
  });

  it('ignores an unknown template id and projects no mission for a bare local chat', async () => {
    const chatId = 'local-mission-launch-2';
    const res = await turnPost(
      new Request('http://roundtable.test/api/orchestrator/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Just a chat', chatId, workflowTemplateId: 'nope' }),
      }),
    );
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.workflow).toBeUndefined();
    expect(await loadMissionForChat(chatId)).toBeNull();
  });
});
