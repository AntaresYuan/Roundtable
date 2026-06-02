import type {
  SandboxCreateOpts,
  SandboxHandle,
  SandboxProvider,
} from './sandbox-provider.js';

export interface E2bProviderOptions {
  /** Defaults to `process.env.E2B_API_KEY`. Required at create-time. */
  apiKey?: string;
  /** Default template name. e2b's `base` is a generic node/python image. */
  defaultTemplate?: string;
}

/**
 * e2b-backed implementation of `SandboxProvider`.
 *
 * The e2b SDK is imported dynamically so unit tests and offline builds don't
 * pay the cost of loading the protobuf transport bundle when they're using
 * `createFakeSandboxProvider()`.
 */
export function createE2bSandboxProvider(opts: E2bProviderOptions = {}): SandboxProvider {
  const apiKey = opts.apiKey ?? process.env['E2B_API_KEY'];
  const defaultTemplate = opts.defaultTemplate ?? 'base';

  return {
    async create(createOpts: SandboxCreateOpts): Promise<SandboxHandle> {
      if (!apiKey) {
        throw new Error(
          'E2B_API_KEY is not set. Configure it or use createFakeSandboxProvider() in tests.',
        );
      }

      const { Sandbox } = await import('e2b');
      const sandbox = await Sandbox.create(createOpts.template ?? defaultTemplate, {
        apiKey,
        ...(createOpts.timeoutMs !== undefined ? { timeoutMs: createOpts.timeoutMs } : {}),
      });

      // Sync files in parallel; e2b's filesystem API takes path/content pairs.
      await Promise.all(
        Object.entries(createOpts.files).map(([path, content]) =>
          sandbox.files.write(path, content),
        ),
      );

      // Launch the entrypoint in the background; the sandbox keeps running
      // until killed or the timeout fires. We don't await the command —
      // it's a long-lived dev server, not a one-shot script.
      if (createOpts.entrypoint) {
        void sandbox.commands.run(createOpts.entrypoint, { background: true });
      }

      const port = createOpts.port ?? 3000;
      const hostname = sandbox.getHost(port);

      return {
        sandboxId: sandbox.sandboxId,
        hostname,
        port,
        async destroy() {
          // e2b uses `kill` on the SandboxApi; suppress errors so destroy is
          // safe to call from the reaper without a try/catch at the call site.
          try {
            const SandboxClass = (await import('e2b')).Sandbox;
            await SandboxClass.kill(sandbox.sandboxId, { apiKey });
          } catch {
            // best-effort
          }
        },
      };
    },
  };
}
