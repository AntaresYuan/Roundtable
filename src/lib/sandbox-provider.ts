/**
 * Vendor-agnostic interface for a sandbox runtime. The default implementation
 * wraps the e2b SDK (`sandbox-provider-e2b.ts`); tests use the in-memory fake
 * factory below so they never need an e2b API key.
 *
 * Keeping `SandboxManager` against this interface (rather than the e2b SDK
 * directly) means we can swap to a different sandbox vendor — or self-host —
 * without touching the quota / signing / reaper logic. See ADR-005.
 */
export interface SandboxProvider {
  create(opts: SandboxCreateOpts): Promise<SandboxHandle>;
}

export interface SandboxCreateOpts {
  /** Vendor template (e.g. "base", "node-20"). Provider-dependent. */
  template?: string;
  /** Path → file contents. Paths are relative to the sandbox working dir. */
  files: Record<string, string>;
  /** Shell command launched after sync (e.g. `pnpm dev`). */
  entrypoint?: string;
  /** Port exposed to the public host. Defaults to 3000. */
  port?: number;
  /** Hard timeout for sandbox lifetime (ms). */
  timeoutMs?: number;
}

export interface SandboxHandle {
  /** Vendor-issued unique id (used by the reaper to call `destroy`). */
  readonly sandboxId: string;
  /** Public hostname for the exposed port (no protocol, no path). */
  readonly hostname: string;
  /** Exposed port. */
  readonly port: number;
  /** Best-effort teardown. Provider should make this idempotent. */
  destroy(): Promise<void>;
}

export interface FakeProviderOptions {
  /** Optional hook: throw / mutate to simulate provider failures in tests. */
  onCreate?: (opts: SandboxCreateOpts) => void;
}

export interface FakeSandboxProvider extends SandboxProvider {
  /** Inspect what was created. */
  readonly created: ReadonlyArray<{
    sandboxId: string;
    opts: SandboxCreateOpts;
    destroyed: boolean;
  }>;
}

/**
 * In-memory provider that records creates and tracks destruction state.
 * The fake hostname pattern is `fake-<n>.sandbox.local` so tests can pattern-match.
 */
export function createFakeSandboxProvider(
  options: FakeProviderOptions = {},
): FakeSandboxProvider {
  let counter = 0;
  const created: Array<{
    sandboxId: string;
    opts: SandboxCreateOpts;
    destroyed: boolean;
  }> = [];

  const provider: FakeSandboxProvider = {
    get created() {
      return created;
    },
    async create(opts) {
      options.onCreate?.(opts);
      counter += 1;
      const sandboxId = `fake-${counter}`;
      const record = { sandboxId, opts, destroyed: false };
      created.push(record);
      return {
        sandboxId,
        hostname: `${sandboxId}.sandbox.local`,
        port: opts.port ?? 3000,
        async destroy() {
          record.destroyed = true;
        },
      };
    },
  };

  return provider;
}
