import type { NextAuthOptions, Session } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

export interface AuthSession extends Session {
  user: AuthUser;
}

export const authOptions: NextAuthOptions = {
  providers: [
    EmailProvider({
      server: process.env.AUTH_EMAIL_SERVER ?? 'smtp://localhost:1025',
      from: process.env.AUTH_EMAIL_FROM ?? 'Roundtable <noreply@roundtable.local>',
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    session({ session, token }) {
      if (session.user?.email) {
        return {
          ...session,
          user: {
            id: token.sub ?? session.user.email,
            email: session.user.email,
            name: session.user.name ?? null,
          },
        };
      }
      return session;
    },
  },
};
