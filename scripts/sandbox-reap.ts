import {
  SandboxManager,
  createE2bSandboxProvider,
} from '../src/lib/index.js';

const secret = process.env['SANDBOX_URL_SIGNING_SECRET'];
if (!secret) {
  process.stderr.write(
    'SANDBOX_URL_SIGNING_SECRET is not set; refusing to start the reaper.\n',
  );
  process.exit(1);
}

const manager = new SandboxManager({
  provider: createE2bSandboxProvider(),
  signingSecret: secret,
});

// NOTE: this script is intended for a one-shot cron sweep. It only sees the
// sandboxes inserted into THIS process's in-memory registry, so in production
// the long-running server (which owns the registry) should run the reaper
// in-process via `startSandboxReaper()`. The script is here so ops has a
// rescue path that lists vendor-side sandboxes (future work).
const killed = await manager.reapIdle();
process.stdout.write(
  `${JSON.stringify({ killedCount: killed.length, killed }, null, 2)}\n`,
);
