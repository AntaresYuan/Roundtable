import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

/**
 * Minimal child-process wrapper for the one-shot `codex exec` CLI:
 *   - feeds the prompt via STDIN (codex reads it when the prompt arg is `-`), so
 *     arbitrary prompt text never has to survive argv/shell quoting
 *   - spawns through a shell so Windows resolves the `codex.cmd` npm shim
 *     (bare `spawn('codex')` throws ENOENT/EINVAL for .cmd files there)
 *   - drains stderr so the child never blocks on a full pipe (cap at 64KB)
 *   - exposes stdout as an async-iterable of JSONL lines
 *
 * Mirrors `adapters/claude-code/process.ts` but tailored to codex's
 * non-interactive, single-turn invocation.
 */
export interface CodexProcess {
  readonly pid: number | undefined;
  lines(): AsyncIterable<string>;
  signal(sig: 'SIGINT' | 'SIGTERM'): void;
  close(): Promise<void>;
  stderrSnapshot(): string;
}

export interface SpawnCodexOpts {
  command: string;
  args: readonly string[];
  cwd: string;
  /** Prompt text fed to codex over stdin (prompt arg is `-`). */
  stdin: string;
  env?: Record<string, string>;
}

export function spawnCodex(opts: SpawnCodexOpts): CodexProcess {
  const proc: ChildProcessWithoutNullStreams = spawn(opts.command, [...opts.args], {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Resolve the codex.cmd/codex shim across platforms. The args are fixed
    // flags (no user text); the prompt travels over stdin, so shell quoting is
    // not a concern here.
    shell: true,
  });

  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');

  let stderrBuf = '';
  proc.stderr.on('data', (chunk: string) => {
    stderrBuf += chunk;
    if (stderrBuf.length > 64 * 1024) {
      stderrBuf = stderrBuf.slice(stderrBuf.length - 64 * 1024);
    }
  });

  // Hand codex the prompt, then close stdin so it stops waiting for more.
  proc.stdin.write(opts.stdin);
  proc.stdin.end();

  const rl: ReadlineInterface = createInterface({ input: proc.stdout });

  let exited = false;
  let spawnError: Error | undefined;
  proc.on('exit', () => {
    exited = true;
  });
  proc.on('error', (error) => {
    spawnError = error;
    exited = true;
    rl.close();
  });

  return {
    get pid() {
      return proc.pid;
    },
    async *lines(): AsyncIterable<string> {
      for await (const line of rl) {
        yield line;
      }
      if (spawnError) throw spawnError;
    },
    signal(sig) {
      if (!exited) proc.kill(sig);
    },
    async close(): Promise<void> {
      if (exited) return;
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        if (exited) return resolve();
        proc.once('exit', () => resolve());
        proc.once('error', () => resolve());
      });
    },
    stderrSnapshot() {
      return stderrBuf;
    },
  };
}
