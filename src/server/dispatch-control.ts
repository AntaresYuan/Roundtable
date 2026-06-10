import type { AgentSession } from '@/contracts';

/**
 * In-process registry of live dispatch runs so the interrupt API route can
 * reach adapter sessions that are otherwise closure-scoped inside the
 * background dispatch promise (spec 010: user stop calls interrupt() on every
 * active session within 1s).
 */
export interface DispatchControl {
  trackSession(session: AgentSession): void;
  untrackSession(session: AgentSession): void;
  isInterrupted(): boolean;
  sessionCount(): number;
}

interface ActiveDispatch {
  sessions: Set<AgentSession>;
  interrupted: boolean;
}

// Keyed off globalThis so the API route and the background dispatch share one
// registry across Next.js dev HMR re-evaluations of this module.
const GLOBAL_KEY = Symbol.for('roundtable.dispatch-control');

function store(): Map<string, ActiveDispatch> {
  const holder = globalThis as { [GLOBAL_KEY]?: Map<string, ActiveDispatch> };
  holder[GLOBAL_KEY] ??= new Map();
  return holder[GLOBAL_KEY];
}

export function registerDispatchControl(turnId: string): DispatchControl {
  const entry: ActiveDispatch = { sessions: new Set(), interrupted: false };
  store().set(turnId, entry);
  return {
    trackSession(session) {
      entry.sessions.add(session);
    },
    untrackSession(session) {
      entry.sessions.delete(session);
    },
    isInterrupted() {
      return entry.interrupted;
    },
    sessionCount() {
      return entry.sessions.size;
    },
  };
}

export function getDispatchControl(turnId: string): DispatchControl | undefined {
  const entry = store().get(turnId);
  if (!entry) return undefined;
  return {
    trackSession: (session) => entry.sessions.add(session),
    untrackSession: (session) => entry.sessions.delete(session),
    isInterrupted: () => entry.interrupted,
    sessionCount: () => entry.sessions.size,
  };
}

export function wasDispatchInterrupted(turnId: string): boolean {
  return store().get(turnId)?.interrupted ?? false;
}

/**
 * Mark the run interrupted and call interrupt() on every active session.
 * Sessions are interrupted concurrently; a rejecting adapter must not block
 * the others (spec 020: best-effort cancellation).
 */
export async function interruptDispatch(
  turnId: string,
): Promise<{ ok: boolean; sessions: number }> {
  const entry = store().get(turnId);
  if (!entry) return { ok: false, sessions: 0 };
  entry.interrupted = true;
  const sessions = [...entry.sessions];
  await Promise.all(
    sessions.map((session) => session.interrupt().catch(() => {})),
  );
  return { ok: true, sessions: sessions.length };
}

export function clearDispatchControl(turnId: string): void {
  store().delete(turnId);
}
