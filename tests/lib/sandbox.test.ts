import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PER_CHAT_BUDGET,
  SandboxManager,
  createFakeSandboxProvider,
  signSandboxUrl,
  startSandboxReaper,
  verifySandboxUrl,
} from '../../src/lib/index.js';

const SECRET = 'test-secret';

function baseInput(overrides: Partial<Parameters<SandboxManager['provision']>[0]> = {}) {
  return {
    artifactId: 'artifact-1',
    chatId: 'chat-1',
    files: { 'index.ts': 'export const x = 1' },
    entrypoint: 'node index.ts',
    ...overrides,
  };
}

describe('SandboxManager.provision', () => {
  it('returns a signed URL on success', async () => {
    const provider = createFakeSandboxProvider();
    const mgr = new SandboxManager({ provider, signingSecret: SECRET });
    const result = await mgr.provision(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sandboxId).toBe('fake-1');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const verify = verifySandboxUrl(result.url, SECRET);
    expect(verify.ok).toBe(true);
    expect(verify.sandboxId).toBe('fake-1');

    expect(provider.created).toHaveLength(1);
    expect(provider.created[0]?.opts.files).toEqual({ 'index.ts': 'export const x = 1' });
  });

  it('rejects empty file lists / missing entrypoint as invalid_input', async () => {
    const mgr = new SandboxManager({
      provider: createFakeSandboxProvider(),
      signingSecret: SECRET,
    });
    const noFiles = await mgr.provision(baseInput({ files: {} }));
    expect(noFiles.ok).toBe(false);
    if (noFiles.ok) return;
    expect(noFiles.error).toBe('invalid_input');

    const noEntry = await mgr.provision(baseInput({ entrypoint: '' }));
    expect(noEntry.ok).toBe(false);
    if (noEntry.ok) return;
    expect(noEntry.error).toBe('invalid_input');
  });

  it('enforces the per-chat budget', async () => {
    const mgr = new SandboxManager({
      provider: createFakeSandboxProvider(),
      signingSecret: SECRET,
      perChatBudget: 2,
    });
    expect((await mgr.provision(baseInput({ artifactId: 'a' }))).ok).toBe(true);
    expect((await mgr.provision(baseInput({ artifactId: 'b' }))).ok).toBe(true);
    const third = await mgr.provision(baseInput({ artifactId: 'c' }));
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.error).toBe('quota_exceeded');
  });

  it('surfaces provider errors as provider_failed (UI falls back to file tree)', async () => {
    const provider = createFakeSandboxProvider({
      onCreate: () => {
        throw new Error('boom: out of quota');
      },
    });
    const mgr = new SandboxManager({ provider, signingSecret: SECRET });
    const result = await mgr.provision(baseInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('provider_failed');
    expect(result.message).toContain('boom');
  });

  it('default per-chat budget is 3', () => {
    expect(DEFAULT_PER_CHAT_BUDGET).toBe(3);
  });
});

describe('SandboxManager idle reaper', () => {
  it('kills sandboxes whose lastAccessedAt is older than idleTimeoutMs', async () => {
    let now = new Date('2026-05-31T00:00:00Z');
    const provider = createFakeSandboxProvider();
    const mgr = new SandboxManager({
      provider,
      signingSecret: SECRET,
      idleTimeoutMs: 5 * 60_000,
      now: () => now,
    });
    await mgr.provision(baseInput());
    await mgr.provision(baseInput({ artifactId: 'a2' }));

    // Advance 3 min — neither is stale yet.
    now = new Date(now.getTime() + 3 * 60_000);
    expect(await mgr.reapIdle()).toEqual([]);

    // Advance to t=6m — both would be eligible (idle > 5m), but we touch
    // fake-1 right before the sweep so only fake-2 should be reaped.
    now = new Date(now.getTime() + 3 * 60_000);
    mgr.touch('fake-1');
    const killed = await mgr.reapIdle();
    expect(killed).toEqual(['fake-2']);
    expect(provider.created.find((c) => c.sandboxId === 'fake-2')?.destroyed).toBe(true);
    expect(provider.created.find((c) => c.sandboxId === 'fake-1')?.destroyed).toBe(false);

    // mgr.list should now only have fake-1
    expect(mgr.list().map((r) => r.sandboxId)).toEqual(['fake-1']);
  });

  it('destroy() is idempotent', async () => {
    const provider = createFakeSandboxProvider();
    const mgr = new SandboxManager({ provider, signingSecret: SECRET });
    await mgr.provision(baseInput());
    await mgr.destroy('fake-1');
    await mgr.destroy('fake-1'); // no throw
    expect(provider.created[0]?.destroyed).toBe(true);
    expect(mgr.list()).toEqual([]);
  });

  it('startSandboxReaper sweeps on the configured interval and stops cleanly', async () => {
    const provider = createFakeSandboxProvider();
    let now = new Date('2026-05-31T00:00:00Z');
    const mgr = new SandboxManager({
      provider,
      signingSecret: SECRET,
      idleTimeoutMs: 1,
      now: () => now,
    });
    await mgr.provision(baseInput());

    const sweeps: string[][] = [];
    const handle = startSandboxReaper({
      manager: mgr,
      intervalMs: 5,
      onSweep: (k) => sweeps.push(k),
    });
    now = new Date(now.getTime() + 1000);

    await new Promise((r) => setTimeout(r, 30));
    handle.stop();
    expect(sweeps.some((s) => s.includes('fake-1'))).toBe(true);
  });
});

describe('signSandboxUrl / verifySandboxUrl', () => {
  it('round-trips a valid URL', () => {
    const url = signSandboxUrl({
      hostname: 'sandbox.example',
      port: 3000,
      sandboxId: 'sbx-123',
      expiresAt: new Date(Date.now() + 60_000),
      secret: SECRET,
    });
    const v = verifySandboxUrl(url, SECRET);
    expect(v.ok).toBe(true);
    expect(v.sandboxId).toBe('sbx-123');
  });

  it('rejects a tampered signature', () => {
    const url = signSandboxUrl({
      hostname: 'h',
      port: 3000,
      sandboxId: 's',
      expiresAt: new Date(Date.now() + 60_000),
      secret: SECRET,
    });
    const tampered = url.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64));
    const v = verifySandboxUrl(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('bad_signature');
  });

  it('rejects tampered URL targets even when sid/exp/sig are preserved', () => {
    const url = signSandboxUrl({
      hostname: 'sandbox.example',
      port: 3000,
      sandboxId: 's',
      expiresAt: new Date(Date.now() + 60_000),
      secret: SECRET,
    });

    const tamperedHost = new URL(url);
    tamperedHost.hostname = 'attacker.example';
    expect(verifySandboxUrl(tamperedHost.toString(), SECRET).reason).toBe('bad_signature');

    const tamperedPort = new URL(url);
    tamperedPort.port = '3001';
    expect(verifySandboxUrl(tamperedPort.toString(), SECRET).reason).toBe('bad_signature');

    const tamperedPath = new URL(url);
    tamperedPath.pathname = '/other';
    expect(verifySandboxUrl(tamperedPath.toString(), SECRET).reason).toBe('bad_signature');
  });

  it('rejects non-https sandbox URLs', () => {
    const url = signSandboxUrl({
      hostname: 'sandbox.example',
      port: 3000,
      sandboxId: 's',
      expiresAt: new Date(Date.now() + 60_000),
      secret: SECRET,
    });
    const downgraded = new URL(url);
    downgraded.protocol = 'http:';

    expect(verifySandboxUrl(downgraded.toString(), SECRET).reason).toBe('bad_url');
  });

  it('rejects an expired URL', () => {
    const past = new Date(Date.now() - 1000);
    const url = signSandboxUrl({
      hostname: 'h',
      port: 3000,
      sandboxId: 's',
      expiresAt: past,
      secret: SECRET,
    });
    const v = verifySandboxUrl(url, SECRET);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('expired');
  });

  it('rejects malformed URLs', () => {
    expect(verifySandboxUrl('not a url', SECRET).ok).toBe(false);
    expect(verifySandboxUrl('https://x/?sid=a&exp=1', SECRET).reason).toBe('bad_url');
  });
});
