import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LocalTurn } from '../../src/server/local-turn-store.js';
import {
  getLocalTurn,
  saveLocalTurn,
} from '../../src/server/local-turn-store.js';
import {
  dispatchApprovedLocalTurn,
  LocalDispatchError,
} from '../../src/server/local-dispatch.js';
import { POST as approvalPost } from '../../src/app/api/orchestrator/approval/route.js';

describe.sequential('local backend workflow', () => {
  let rootDir: string;
  let previousRoot: string | undefined;
  let previousStore: string | undefined;
  let previousHandoffLog: string | undefined;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'roundtable-local-workflow-'));
    previousRoot = process.env['ROUNDTABLE_LOCAL_ROOT'];
    previousStore = process.env['ROUNDTABLE_LOCAL_TURN_STORE'];
    previousHandoffLog = process.env['ROUNDTABLE_HANDOFF_LOG'];
    process.env['ROUNDTABLE_LOCAL_ROOT'] = join(rootDir, '.roundtable');
    process.env['ROUNDTABLE_LOCAL_TURN_STORE'] = join(rootDir, 'local-turns.json');
    // Isolate the hand-off audit log so dispatch in tests does not append to the
    // repo-tracked ai-logs/handoffs.jsonl (the default since issue #135).
    process.env['ROUNDTABLE_HANDOFF_LOG'] = join(rootDir, 'handoffs.jsonl');
  });

  afterEach(async () => {
    restoreEnv('ROUNDTABLE_LOCAL_ROOT', previousRoot);
    restoreEnv('ROUNDTABLE_LOCAL_TURN_STORE', previousStore);
    restoreEnv('ROUNDTABLE_HANDOFF_LOG', previousHandoffLog);
    await rm(rootDir, { recursive: true, force: true });
  });

  it('keeps approval and dispatch as separate backend steps by default', async () => {
    await saveLocalTurn(seedTurn('turn-approval-only'));

    const response = await approvalPost(jsonRequest({
      turnId: 'turn-approval-only',
      decision: 'approve',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      id: 'turn-approval-only',
      approvalStatus: 'approved',
    });
    expect(body.records).toBeUndefined();

    const stored = await getLocalTurn('turn-approval-only');
    expect(stored?.approvalStatus).toBe('approved');
    expect(stored?.dispatchStatus).toBeUndefined();
    expect(stored?.dispatch).toBeUndefined();
  });

  it('records requested changes without marking the turn approved', async () => {
    await saveLocalTurn(seedTurn('turn-changes'));

    const response = await approvalPost(jsonRequest({
      turnId: 'turn-changes',
      decision: 'request_changes',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      id: 'turn-changes',
      approvalStatus: 'changes_requested',
    });
    expect(body.approvedAt).toBeUndefined();

    const stored = await getLocalTurn('turn-changes');
    expect(stored?.approvalStatus).toBe('changes_requested');
    expect(stored?.approvedAt).toBeUndefined();
  });

  it('dispatches an approved local turn and persists agent events plus artifacts', async () => {
    await saveLocalTurn({
      ...seedTurn('turn-dispatch'),
      needsApproval: false,
      approvalStatus: 'approved',
      approvedAt: new Date().toISOString(),
    });

    const result = await dispatchApprovedLocalTurn('turn-dispatch');

    expect(result).toMatchObject({
      ok: true,
      id: 'turn-dispatch',
      dispatchStatus: 'completed',
      dispatchStage: 'review',
    });
    expect(result.workspacePath).toContain('local-turn-dispatch');
    expect(result.records).toHaveLength(2);
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual(['markdown', 'code']);
    expect(result.records.every((record) => record.status === 'completed')).toBe(true);
    expect(result.records[0]?.events.some((event) => event.type === 'tool_result')).toBe(true);
    expect(result.records[0]?.events.some((event) => event.type === 'file_change')).toBe(true);
    expect(result.records[0]?.events.some((event) => event.type === 'artifact')).toBe(true);
    const firstArtifact = result.artifacts[0];
    expect(firstArtifact).toBeDefined();
    const firstFile = await readFile(join(result.workspacePath!, firstArtifact!.title), 'utf8');
    expect(firstFile).toBe(firstArtifact!.preview);

    const stored = await getLocalTurn('turn-dispatch');
    expect(stored?.dispatchStatus).toBe('completed');
    expect(stored?.dispatch).toHaveLength(2);
    expect(stored?.artifacts).toHaveLength(2);
    expect(stored?.dispatchWorkspacePath).toBe(result.workspacePath);
    expect(stored?.dispatchError).toBeUndefined();
  });

  it('creates a runnable preview artifact for React page work', async () => {
    await saveLocalTurn({
      ...seedTurn('turn-preview'),
      needsApproval: false,
      approvalStatus: 'approved',
      approvedAt: new Date().toISOString(),
      plan: {
        id: 'turn-preview-plan',
        createdAt: new Date(),
        tasks: [
          {
            id: 'T1',
            title: 'Implement React counter page',
            assignee: '@implementer',
            deps: [],
            user_visible: true,
            status: 'pending',
          },
        ],
      },
    });

    const result = await dispatchApprovedLocalTurn('turn-preview');

    expect(result.dispatchStatus).toBe('completed');
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual(['code', 'preview']);
    const preview = result.artifacts.find((artifact) => artifact.kind === 'preview');
    expect(preview?.title).toMatch(/^preview\/.+\.html$/);
    expect(preview?.preview).toContain('ReactDOM.createRoot');
    expect(preview?.preview).toContain('<div id="root"></div>');
    expect(preview?.preview).toContain('useId');
    expect(preview?.preview).toContain("filename: 'preview.tsx'");
    expect(preview?.preview).toContain("['react', { runtime: 'classic' }]");
    expect(preview?.preview).toContain('Preview failed to render:');
    expect(preview?.preview).toContain('function GeneratedTodoPage()');
    expect(preview?.preview).toContain('render(<GeneratedTodoPage />)');
    expect(preview?.preview).not.toContain('render(<function />)');
    expect(preview?.preview).not.toContain("from 'react'");
  });

  it('treats webpage implementation work as previewable React code', async () => {
    await saveLocalTurn({
      ...seedTurn('turn-webpage'),
      needsApproval: false,
      approvalStatus: 'approved',
      approvedAt: new Date().toISOString(),
      plan: {
        id: 'turn-webpage-plan',
        createdAt: new Date(),
        tasks: [
          {
            id: 'T1',
            title: 'Implement camera gradient ranking webpage',
            assignee: '@implementer',
            deps: [],
            user_visible: true,
            status: 'pending',
          },
        ],
      },
    });

    const result = await dispatchApprovedLocalTurn('turn-webpage');

    expect(result.dispatchStatus).toBe('completed');
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual(['code', 'preview']);
    expect(result.artifacts[0]?.title).toMatch(/^app\/implement-camera-gradient-ranking-webpage\.tsx$/);
    expect(result.artifacts[1]?.title).toMatch(/^preview\/app-implement-camera-gradient-ranking-webpage\.html$/);
  });

  it('treats HTML slideshow and PPT work as a rendered HTML artifact', async () => {
    await saveLocalTurn({
      ...seedTurn('turn-html-slides'),
      needsApproval: false,
      approvalStatus: 'approved',
      approvedAt: new Date().toISOString(),
      plan: {
        id: 'turn-html-slides-plan',
        createdAt: new Date(),
        tasks: [
          {
            id: 'T1',
            title: 'Create bright color HTML slideshow PPT with keyboard navigation',
            assignee: '@implementer',
            deps: [],
            user_visible: true,
            status: 'pending',
          },
        ],
      },
    });

    const result = await dispatchApprovedLocalTurn('turn-html-slides');

    expect(result.dispatchStatus).toBe('completed');
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual(['html']);
    expect(result.artifacts[0]?.title).toMatch(/^app\/create-bright-color-html-slideshow-ppt-with-keyb\.html$/);
    expect(result.artifacts[0]?.preview).toContain('<!doctype html>');
    expect(result.artifacts[0]?.preview).toContain('Generated HTML slide deck');
    expect(result.artifacts[0]?.preview).toContain('ArrowRight');
  });

  it('continues the same local project workspace on follow-up turns', async () => {
    const localChatId = 'project-chat';
    await saveLocalTurn({
      ...seedTurn('turn-project-initial'),
      localChatId,
      needsApproval: false,
      approvalStatus: 'approved',
      approvedAt: new Date().toISOString(),
      plan: {
        id: 'turn-project-initial-plan',
        createdAt: new Date(),
        tasks: [
          {
            id: 'T1',
            title: 'Implement React camera ranking webpage',
            assignee: '@implementer',
            deps: [],
            user_visible: true,
            status: 'pending',
          },
        ],
      },
    });

    const first = await dispatchApprovedLocalTurn('turn-project-initial');
    const firstCode = first.artifacts.find((artifact) => artifact.kind === 'code');

    await saveLocalTurn({
      ...seedTurn('turn-project-followup'),
      localChatId,
      message: '继续优化这个页面，加上筛选和排序',
      needsApproval: false,
      approvalStatus: 'approved',
      approvedAt: new Date().toISOString(),
      plan: {
        id: 'turn-project-followup-plan',
        createdAt: new Date(),
        tasks: [
          {
            id: 'T1',
            title: '继续优化这个页面，加上筛选和排序',
            assignee: '@implementer',
            deps: [],
            user_visible: true,
            status: 'pending',
          },
        ],
      },
    });

    const second = await dispatchApprovedLocalTurn('turn-project-followup');
    const secondCode = second.artifacts.find((artifact) => artifact.kind === 'code');

    expect(first.workspacePath).toBe(second.workspacePath);
    expect(first.workspacePath).toContain('project-chat');
    expect(firstCode?.title).toBe('app/implement-react-camera-ranking-webpage.tsx');
    expect(secondCode?.title).toBe(firstCode?.title);
    expect(second.artifacts.map((artifact) => artifact.kind)).toEqual(['code', 'preview']);
  });

  it('supports an explicit approve-and-dispatch smoke step', async () => {
    await saveLocalTurn(seedTurn('turn-smoke'));

    const response = await approvalPost(jsonRequest({
      turnId: 'turn-smoke',
      decision: 'approve',
      autoDispatch: true,
    }));
    const body = await response.json();

    // autoDispatch fires the dispatch in the background and returns immediately
    // with 'running'; the client polls for the result instead of blocking.
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      id: 'turn-smoke',
      approvalStatus: 'approved',
      dispatchStatus: 'running',
    });

    const stored = await waitForDispatch('turn-smoke');
    expect(stored?.approvalStatus).toBe('approved');
    expect(stored?.dispatchStatus).toBe('completed');
    expect(stored?.dispatch).toHaveLength(2);
  });

  it('rejects dispatch before approval', async () => {
    await saveLocalTurn(seedTurn('turn-unapproved'));

    await expect(dispatchApprovedLocalTurn('turn-unapproved')).rejects.toMatchObject({
      code: 'turn_not_approved',
      status: 409,
    } satisfies Partial<LocalDispatchError>);
  });

  it('rejects approval when there is no backend plan to approve', async () => {
    await saveLocalTurn({
      id: 'turn-error',
      message: 'This turn failed before planning',
      status: 'error',
      createdAt: new Date().toISOString(),
      error: 'llm_plan_failed',
    });

    const response = await approvalPost(jsonRequest({
      turnId: 'turn-error',
      decision: 'approve',
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ ok: false, error: 'turn_has_no_plan' });
  });
});

function seedTurn(id: string): LocalTurn {
  return {
    id,
    message: 'Build a backend workflow pane from intake through dispatch',
    status: 'done',
    createdAt: new Date().toISOString(),
    provider: 'test-provider',
    model: 'test-model',
    pmMessage: 'I drafted a two-task backend workflow plan.',
    needsApproval: true,
    approvalStatus: 'pending',
    intake: {
      intentType: 'build',
      clarity: 'clear',
      ambiguityScore: 0.05,
      complexity: 'multi_agent',
      risk: 'medium',
      suggestedRoles: ['planner', 'implementer'],
      userVisibleSummary: 'Build the backend workflow path.',
    },
    plan: {
      id: `${id}-plan`,
      createdAt: new Date(),
      tasks: [
        {
          id: 'T1',
          title: 'Define the backend workflow contract',
          assignee: '@planner',
          deps: [],
          parallel: true,
          user_visible: true,
          status: 'pending',
        },
        {
          id: 'T2',
          title: 'Implement the workflow execution endpoint',
          assignee: '@implementer',
          deps: ['T1'],
          user_visible: true,
          status: 'pending',
        },
      ],
    },
  };
}

async function waitForDispatch(id: string): Promise<LocalTurn | null> {
  for (let i = 0; i < 120; i += 1) {
    const turn = await getLocalTurn(id);
    if (turn?.dispatchStatus === 'completed' || turn?.dispatchStatus === 'failed') return turn;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return getLocalTurn(id);
}

function jsonRequest(body: unknown): Request {
  return new Request('http://roundtable.test/api/orchestrator/approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
