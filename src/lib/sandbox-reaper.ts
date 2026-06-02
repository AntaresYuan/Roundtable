import type { SandboxManager } from './sandbox.js';

export interface SandboxReaperOptions {
  manager: SandboxManager;
  /** Interval between sweeps. Default 60s. */
  intervalMs?: number;
  /** Called with the count of sandboxes killed each sweep. */
  onSweep?: (killed: string[]) => void;
}

export interface SandboxReaperHandle {
  stop(): void;
}

/**
 * Long-running reaper that periodically asks the manager to kill idle
 * sandboxes. Designed for a server process; the cron-style alternative is
 * `scripts/sandbox-reap.ts` which performs one sweep and exits.
 */
export function startSandboxReaper(opts: SandboxReaperOptions): SandboxReaperHandle {
  const intervalMs = opts.intervalMs ?? 60_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const killed = await opts.manager.reapIdle();
      opts.onSweep?.(killed);
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, intervalMs);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
