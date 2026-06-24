import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { TRPCContext } from './context.js';
import { assertRateLimit } from './rate-limit.js';

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedRateLimitedProcedure = protectedProcedure.use(
  ({ ctx, path, next }) => {
    assertRateLimit(`${ctx.user.id}:${path}`);
    return next();
  },
);

export const publicRateLimitedProcedure = publicProcedure.use(
  ({ ctx, path, next }) => {
    assertRateLimit(`${ctx.user?.id ?? 'anonymous'}:${path}`);
    return next();
  },
);
