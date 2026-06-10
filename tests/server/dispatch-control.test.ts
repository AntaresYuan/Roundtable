import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearDispatchControl,
  getDispatchControl,
  interruptDispatch,
  registerDispatchControl,
} from '../../src/server/dispatch-control.js';
import { AdapterRegistry } from '../../src/adapters/index.js';
import {
  inMemoryHandoffLog,
  workspaceResolver,
} from '../../src/orchestrator/index.js';
import { runDispatch } from '../../src/orchestrator/nodes/dispatch.js';
import { initialState } from '../../src/orchestrator/state.js';
import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  PlanTask,
  SessionOpts,
  UserInput,
} from '../../src/contracts/index.js';

function fakeSession(id: string, onInterrupt: () => void): AgentSession {
  return {
    id,
    adapterId: 'mock',
    cwd: '/tmp',
    async *send(_input: UserInput): AsyncIterable<AgentEvent> {
      return;
    },
    async interrupt(): Promise<void> {
      onInterrupt();
    },
    async close(): Promise<void> {},
  };
}

describe('dispatch control registry', () => {
  it('interrupts every tracked session within 1s of the stop call (spec 010 AC)', async () => {
    const control = registerDispatchControl('turn-1s');
    const interruptedAt: number[] = [];
    const sessions = ['s1', 's2', 's3'].map((id) =>
      fakeSession(id, () => interruptedAt.push(Date.now())),
    );
    for (const session of sessions) control.trackSession(session);

    const clickedAt = Date.now();
    const result = await interruptDispatch('turn-1s');

    expect(result).toEqual({ ok: true, sessions: 3 });
    expect(interruptedAt).toHaveLength(3);
    for (const ts of interruptedAt) {
      expect(ts - clickedAt).toBeLessThanOrEqual(1000);
    }
    clearDispatchControl('turn-1s');
  });

  it('marks the run interrupted so pending work can stop', async () => {
    const control = registerDispatchControl('turn-flag');
    expect(control.isInterrupted()).toBe(false);
    await interruptDispatch('turn-flag');
    expect(control.isInterrupted()).toBe(true);
    clearDispatchControl('turn-flag');
  });

  it('returns ok:false when no dispatch is active for the turn', async () => {
    expect(await interruptDispatch('turn-missing')).toEqual({ ok: false, sessions: 0 });
  });

  it('stops tracking sessions that already finished', async () => {
    const control = registerDispatchControl('turn-untrack');
    let calls = 0;
    const session = fakeSession('s1', () => { calls += 1; });
    control.trackSession(session);
    control.untrackSession(session);

    const result = await interruptDispatch('turn-untrack');
    expect(result.sessions).toBe(0);
    expect(calls).toBe(0);
    clearDispatchControl('turn-untrack');
  });

  it('survives a session whose interrupt() rejects', async () => {
    const control = registerDispatchControl('turn-reject');
    let healthyInterrupted = false;
    control.trackSession({
      ...fakeSession('bad', () => {}),
      async interrupt() {
        throw new Error('adapter exploded');
      },
    });
    control.trackSession(fakeSession('good', () => { healthyInterrupted = true; }));

    const result = await interruptDispatch('turn-reject');
    expect(result.ok).toBe(true);
    expect(healthyInterrupted).toBe(true);
    clearDispatchControl('turn-reject');
  });

  it('clears control state after the dispatch unwinds', () => {
    registerDispatchControl('turn-clear');
    clearDispatchControl('turn-clear');
    expect(getDispatchControl('turn-clear')).toBeUndefined();
  });
});

describe('runDispatch with interrupt control', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'roundtable-interrupt-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('does not start later waves once the run is interrupted', async () => {
    const control = registerDispatchControl('turn-waves');
    const started: string[] = [];
    const registry = new AdapterRegistry();
    // The session for T1 simulates the user clicking stop mid-task.
    registry.register(adapterThatInterruptsDuringFirstTask(started, () => {
      void interruptDispatch('turn-waves');
    }));
    registry.bindRole('implementer', 'stoppable');

    const result = await runDispatch(stateWithSequentialTasks(), {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
      control,
    });

    expect(started).toEqual(['T1']);
    expect(result.dispatch.map((r) => r.taskId)).toEqual(['T1']);
    clearDispatchControl('turn-waves');
  });

  it('tracks sessions for the lifetime of each attempt', async () => {
    const control = registerDispatchControl('turn-track');
    const registry = new AdapterRegistry();
    const started: string[] = [];
    registry.register(adapterThatInterruptsDuringFirstTask(started, () => {
      const active = getDispatchControl('turn-track');
      expect(active?.sessionCount()).toBe(1);
    }));
    registry.bindRole('implementer', 'stoppable');

    await runDispatch(stateWithSequentialTasks(), {
      registry,
      workspaces: workspaceResolver(rootDir),
      handoffLog: inMemoryHandoffLog(),
      control,
    });

    expect(control.sessionCount()).toBe(0);
    clearDispatchControl('turn-track');
  });
});

function stateWithSequentialTasks() {
  const tasks: PlanTask[] = [
    { id: 'T1', title: 'First task', assignee: '@implementer', deps: [], user_visible: true, status: 'pending' },
    { id: 'T2', title: 'Second task', assignee: '@implementer', deps: ['T1'], user_visible: true, status: 'pending' },
  ];
  return {
    ...initialState('chat/interrupt', 'build a page'),
    stage: 'dispatch' as const,
    plan: { id: 'plan-1', createdAt: new Date(), tasks },
  };
}

function adapterThatInterruptsDuringFirstTask(
  started: string[],
  onFirstTaskMidStream: () => void,
): AgentAdapter {
  let sessionCounter = 0;
  return {
    id: 'stoppable',
    displayName: 'Stoppable Agent',
    avatar: 'S',
    capabilities: {
      streaming: true,
      toolUse: false,
      fileEdits: false,
      persistentSessions: false,
      mcp: false,
      multimodal: false,
    },
    async createSession(opts: SessionOpts): Promise<AgentSession> {
      sessionCounter += 1;
      const id = `session-${sessionCounter}`;
      return {
        id,
        adapterId: 'stoppable',
        cwd: opts.cwd,
        async *send(input: UserInput): AsyncIterable<AgentEvent> {
          const taskId = /First task/.test(input.text) ? 'T1' : 'T2';
          started.push(taskId);
          yield { type: 'text_delta', delta: `working on ${taskId}` };
          if (taskId === 'T1') onFirstTaskMidStream();
          yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
        },
        async interrupt(): Promise<void> {},
        async close(): Promise<void> {},
      };
    },
  };
}
