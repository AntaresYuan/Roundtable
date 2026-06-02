import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  SandboxHandle,
  SandboxProvider,
} from './sandbox-provider.js';

/** Default per-chat budget for concurrent sandboxes. */
export const DEFAULT_PER_CHAT_BUDGET = 3;

/** Default TTL for a signed sandbox URL. */
export const DEFAULT_URL_TTL_MS = 30 * 60_000; // 30 min

/** Default idle window before the reaper kills a sandbox. */
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000; // 10 min

export interface ProvisionInput {
  artifactId: string;
  chatId: string;
  /** File path → content. Paths relative to the sandbox working dir. */
  files: Record<string, string>;
  /** Shell command to launch the app (e.g. `pnpm dev`). */
  entrypoint: string;
  /** Port exposed for the iframe. Defaults to 3000. */
  port?: number;
  /** Vendor template override (provider-specific). */
  template?: string;
}

export type ProvisionResult =
  | {
      ok: true;
      url: string;
      sandboxId: string;
      expiresAt: Date;
    }
  | {
      ok: false;
      error: 'quota_exceeded' | 'provider_failed' | 'invalid_input';
      message: string;
    };

export interface SandboxRecord {
  sandboxId: string;
  chatId: string;
  artifactId: string;
  hostname: string;
  port: number;
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt: Date;
}

export interface SandboxRegistry {
  insert(record: SandboxRecord, handle: SandboxHandle): void;
  remove(sandboxId: string): SandboxHandle | undefined;
  get(sandboxId: string): SandboxRecord | undefined;
  touch(sandboxId: string, at: Date): void;
  list(): readonly SandboxRecord[];
  countForChat(chatId: string): number;
}

export interface SandboxManagerOptions {
  provider: SandboxProvider;
  /** HMAC secret for URL signing. Required (no insecure default). */
  signingSecret: string;
  /** Max concurrent sandboxes per chat. Default 3. */
  perChatBudget?: number;
  /** Signed-URL TTL. Default 30 minutes. */
  urlTtlMs?: number;
  /** Idle window before the reaper destroys a sandbox. Default 10 minutes. */
  idleTimeoutMs?: number;
  /** Inject for tests; default is in-memory. */
  registry?: SandboxRegistry;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * Provisions e2b sandboxes for `web_app` artifacts, enforces per-chat quota,
 * signs the public URL, and tracks idle state for the reaper.
 *
 * Lifecycle (per ADR-005):
 *   1. `provision()` rejects when chat is over budget or input is empty.
 *   2. Provider creates the sandbox and exposes a hostname for `port`.
 *   3. We sign `https://{hostname}:{port}` with HMAC + expiry, hand the URL
 *      to the UI.
 *   4. UI calls `touch(sandboxId)` on user interaction; reaper kills
 *      sandboxes idle for > `idleTimeoutMs`.
 *   5. `destroy(sandboxId)` is idempotent and tears down the vendor sandbox.
 *
 * On any provider error we return `{ ok: false }` so the UI degrades to the
 * file-tree fallback (spec 040 § Hybrid rendering policy).
 */
export class SandboxManager {
  private readonly provider: SandboxProvider;
  private readonly secret: string;
  private readonly perChatBudget: number;
  private readonly urlTtlMs: number;
  private readonly idleTimeoutMs: number;
  private readonly registry: SandboxRegistry;
  private readonly now: () => Date;

  constructor(opts: SandboxManagerOptions) {
    if (!opts.signingSecret) {
      throw new Error('SandboxManager: signingSecret is required.');
    }
    this.provider = opts.provider;
    this.secret = opts.signingSecret;
    this.perChatBudget = opts.perChatBudget ?? DEFAULT_PER_CHAT_BUDGET;
    this.urlTtlMs = opts.urlTtlMs ?? DEFAULT_URL_TTL_MS;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.registry = opts.registry ?? createInMemoryRegistry();
    this.now = opts.now ?? (() => new Date());
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    if (!input.entrypoint || Object.keys(input.files).length === 0) {
      return {
        ok: false,
        error: 'invalid_input',
        message: 'entrypoint and at least one file are required.',
      };
    }
    if (this.registry.countForChat(input.chatId) >= this.perChatBudget) {
      return {
        ok: false,
        error: 'quota_exceeded',
        message: `Chat ${input.chatId} reached its sandbox budget of ${this.perChatBudget}.`,
      };
    }

    let handle: SandboxHandle;
    try {
      const port = input.port ?? 3000;
      const createOpts = {
        files: input.files,
        entrypoint: input.entrypoint,
        port,
        ...(input.template !== undefined ? { template: input.template } : {}),
      };
      handle = await this.provider.create(createOpts);
    } catch (err) {
      return {
        ok: false,
        error: 'provider_failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.urlTtlMs);
    const record: SandboxRecord = {
      sandboxId: handle.sandboxId,
      chatId: input.chatId,
      artifactId: input.artifactId,
      hostname: handle.hostname,
      port: handle.port,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt,
    };
    this.registry.insert(record, handle);

    return {
      ok: true,
      url: signSandboxUrl({
        hostname: handle.hostname,
        port: handle.port,
        sandboxId: handle.sandboxId,
        expiresAt,
        secret: this.secret,
      }),
      sandboxId: handle.sandboxId,
      expiresAt,
    };
  }

  /** Mark a sandbox as recently used so the reaper leaves it alone. */
  touch(sandboxId: string): void {
    this.registry.touch(sandboxId, this.now());
  }

  /** Destroy a single sandbox. No-op if it was already removed. */
  async destroy(sandboxId: string): Promise<void> {
    const handle = this.registry.remove(sandboxId);
    if (handle) await handle.destroy();
  }

  /**
   * Kill every sandbox idle for longer than `idleTimeoutMs`.
   * Returns the ids that were destroyed.
   */
  async reapIdle(): Promise<string[]> {
    const nowMs = this.now().getTime();
    const stale = this.registry
      .list()
      .filter((r) => nowMs - r.lastAccessedAt.getTime() > this.idleTimeoutMs);
    const killed: string[] = [];
    for (const record of stale) {
      const handle = this.registry.remove(record.sandboxId);
      if (handle) {
        try {
          await handle.destroy();
        } catch {
          // best-effort teardown
        }
      }
      killed.push(record.sandboxId);
    }
    return killed;
  }

  list(): readonly SandboxRecord[] {
    return this.registry.list();
  }
}

function createInMemoryRegistry(): SandboxRegistry {
  const records = new Map<string, SandboxRecord>();
  const handles = new Map<string, SandboxHandle>();
  return {
    insert(record, handle) {
      records.set(record.sandboxId, record);
      handles.set(record.sandboxId, handle);
    },
    remove(sandboxId) {
      records.delete(sandboxId);
      const handle = handles.get(sandboxId);
      handles.delete(sandboxId);
      return handle;
    },
    get(sandboxId) {
      return records.get(sandboxId);
    },
    touch(sandboxId, at) {
      const existing = records.get(sandboxId);
      if (existing) records.set(sandboxId, { ...existing, lastAccessedAt: at });
    },
    list() {
      return Array.from(records.values());
    },
    countForChat(chatId) {
      let n = 0;
      for (const r of records.values()) if (r.chatId === chatId) n += 1;
      return n;
    },
  };
}

// ── URL signing ─────────────────────────────────────────────────────────────

export interface SignSandboxUrlInput {
  hostname: string;
  port: number;
  sandboxId: string;
  expiresAt: Date;
  secret: string;
}

/**
 * Build `https://{hostname}:{port}?sid=&exp=&sig=` with an HMAC over the
 * canonical URL target plus sandbox id and expiry, so host/port/path cannot be
 * tampered with after issue.
 *
 * The sandbox id is encoded in the query string (not the host) because e2b
 * hostnames already encode their sandbox id but consumers may rewrite the
 * host (proxies, custom domains).
 */
export function signSandboxUrl(input: SignSandboxUrlInput): string {
  const expMs = input.expiresAt.getTime();
  const sig = hmac(
    input.secret,
    sandboxUrlPayload({
      protocol: 'https:',
      hostname: input.hostname,
      port: input.port,
      pathname: '/',
      sandboxId: input.sandboxId,
      expMs,
    }),
  );
  const port = input.port === 443 ? '' : `:${input.port}`;
  return `https://${input.hostname}${port}?sid=${encodeURIComponent(input.sandboxId)}&exp=${expMs}&sig=${sig}`;
}

export interface VerifySandboxUrlResult {
  ok: boolean;
  sandboxId?: string;
  reason?: 'bad_url' | 'bad_signature' | 'expired';
}

/**
 * Verify a URL produced by `signSandboxUrl`. Use for the server-side proxy or
 * UI guard before iframe-ing untrusted content. `now` is injectable for tests.
 */
export function verifySandboxUrl(
  url: string,
  secret: string,
  now: () => Date = () => new Date(),
): VerifySandboxUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'bad_url' };
  }
  const sid = parsed.searchParams.get('sid');
  const exp = parsed.searchParams.get('exp');
  const sig = parsed.searchParams.get('sig');
  if (!sid || !exp || !sig) return { ok: false, reason: 'bad_url' };
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'bad_url' };
  const port = parsed.port ? Number(parsed.port) : 443;
  if (!Number.isInteger(port) || port <= 0) return { ok: false, reason: 'bad_url' };

  const expected = hmac(
    secret,
    sandboxUrlPayload({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port,
      pathname: parsed.pathname,
      sandboxId: sid,
      expMs: exp,
    }),
  );
  // Constant-time compare to avoid signature timing leaks.
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || now().getTime() > expMs) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, sandboxId: sid };
}

function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function sandboxUrlPayload(input: {
  protocol: 'https:';
  hostname: string;
  port: number;
  pathname: string;
  sandboxId: string;
  expMs: number | string;
}): string {
  return [
    input.protocol,
    input.hostname.toLowerCase(),
    String(input.port),
    input.pathname,
    input.sandboxId,
    String(input.expMs),
  ].join('\n');
}
