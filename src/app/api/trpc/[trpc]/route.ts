import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/root';
import { createNextTRPCContext } from '@/server/context';

// Uses the server seam from #86 (createNextTRPCContext resolves the NextAuth
// session) so protectedProcedures work over HTTP.
const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createNextTRPCContext(),
  });

export { handler as GET, handler as POST };
