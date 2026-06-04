/**
 * NextAuth v4 App-Router handler. Lives under `/api/auth/*` so the same
 * authOptions feed both the frontend session and `getServerSession(...)` in
 * server contexts (tRPC route + RSC).
 */
import NextAuth from 'next-auth';
import { authOptions } from '@/server/auth';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
