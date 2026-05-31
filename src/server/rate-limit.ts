import { TRPCError } from '@trpc/server';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function assertRateLimit(
  key: string,
  opts: RateLimitOptions = { limit: 60, windowMs: 60_000 },
): void {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return;
  }

  if (existing.count >= opts.limit) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded. Please retry shortly.',
    });
  }

  existing.count += 1;
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}
