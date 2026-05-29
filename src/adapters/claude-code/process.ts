import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

/**
 * Minimal child-process wrapper that:
 *   - drains stderr so the child does not block on a full pipe (cap at 64KB)
 *   - exposes stdout as an async-iterable of NDJSON lines
 *   - guarantees clean termination on close/interrupt
 */
export interface CliProcess {
  readonly pid: number | undefined;
  lines(): AsyncIterable<string>;
  write(payload: string): Promise<void>;
  signal(sig: 'SIGINT' | 'SIGTERM'): void;
  close(): Promise<void>;
  stderrSnapshot(): string;
}

export interface SpawnCliOpts {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: Record<string, string>;
}

export function spawnCli(opts: SpawnCliOpts): CliProcess {
  const proc: ChildProcessWithoutNullStreams = spawn(opts.command, [...opts.args], {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
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
    async write(payload: string): Promise<void> {
      if (spawnError) throw spawnError;
      if (exited) throw new Error('CLI process already exited');
      await new Promise<void>((resolve, reject) => {
        proc.stdin.write(payload, (err) => (err ? reject(err) : resolve()));
      });
    },
    signal(sig) {
      if (!exited) proc.kill(sig);
    },
    async close(): Promise<void> {
      if (exited) return;
      proc.stdin.end();
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
