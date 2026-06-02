# ADR-005: e2b sandbox provisioning for `web_app` artifacts

## Status

Accepted (2026-05-31)

## Context

Spec 040 declares that `web_app` artifacts render as a live `<iframe>` so the user can interact with what the agents just built. We need to spin up a real runtime per artifact (npm install, dev server, port exposed) without operating our own infrastructure. The options:

- **e2b cloud sandboxes** — turnkey API, per-second billing, file sync + command execution + exposed ports.
- **Self-hosted Docker** — full control, painful ops (registry, networking, GC) for a 3-week sprint.
- **Webcontainers (StackBlitz)** — browser-only, no real server processes.

## Decision

Use **e2b** as the v1 provider, with a thin `SandboxProvider` interface in our own code so we can swap vendors (or self-host) later without rewriting the quota / URL / reaper logic.

## Why

- **Time-to-demo.** e2b's `Sandbox.create()` + `files.write()` + `commands.run()` + `getHost(port)` fits the artifact shape (`files`, `entrypoint`, exposed port) almost 1:1.
- **Per-chat cost ceiling.** e2b bills per-second; combined with our `perChatBudget` (default 3) and the idle reaper (default 10 min), the worst-case spend is bounded.
- **Signed URLs are still our job.** e2b hostnames are guessable, so we wrap them with HMAC + expiry (`signSandboxUrl`) before handing to the UI. Verification belongs on the proxy/route side.
- **The interface lets us bail.** If e2b's reliability or pricing don't hold up, swapping in a Modal / Vercel sandbox is a single new `SandboxProvider` implementation — no callers change.

## Consequences

- We depend on `e2b@^2.27.0`. The SDK is dynamically imported in `sandbox-provider-e2b.ts` so unit tests / offline builds don't pay the load cost.
- `E2B_API_KEY` and `SANDBOX_URL_SIGNING_SECRET` are required env vars for the prod path; tests use `createFakeSandboxProvider()` and an inline secret.
- The per-chat budget is enforced in-memory by `SandboxManager`. After a process restart the counter resets — fine for a single-server demo, but a multi-server deployment needs a shared registry (out of scope here, tracked separately).
- The reaper currently only sees sandboxes in the local `SandboxRegistry`. The `pnpm sandbox:reap` CLI exists as an ops rescue path but won't kill orphans created by an exited process; the long-running server is expected to run `startSandboxReaper()` in-process.

## AI assistance

- Designed in conjunction with implementation in PR closing #42.
- Reviewed e2b SDK shape directly from `node_modules/e2b/dist/index.d.ts` rather than docs to confirm `Sandbox.create`, `files.write`, `commands.run(..., { background: true })`, and `getHost(port)` are real.
