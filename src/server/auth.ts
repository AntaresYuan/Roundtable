import type { NextAuthOptions, Session } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import CredentialsProvider from 'next-auth/providers/credentials';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from '../db/index.js';
import { users } from '../db/schema.js';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

export interface AuthSession extends Session {
  user: AuthUser;
}

// NOTE (auth — server lane, @Peitong): email magic-link needs a NextAuth adapter
// (+ accounts/sessions/verification_tokens tables), not configured yet. Until
// then, local dev uses an email-only Credentials shortcut (upserts a real users
// row so the session id is a uuid that satisfies owner-scoped uuid FKs). Email
// provider stays opt-in to avoid EMAIL_REQUIRES_ADAPTER_ERROR on session checks.
const devLogin = CredentialsProvider({
  id: 'dev',
  name: 'Dev login (email only)',
  credentials: { email: { label: 'Email', type: 'email' } },
  async authorize(creds) {
    const email = creds?.email?.trim().toLowerCase();
    if (!email) return null;
    const { db, client } = createDbClient();
    try {
      const found = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      const id =
        found[0]?.id ??
        (await db.insert(users).values({ id: randomUUID(), email }).returning({ id: users.id }))[0]?.id;
      return id ? { id, email, name: email.split('@')[0] ?? email } : null;
    } finally {
      await client.end();
    }
  },
});

export const authOptions: NextAuthOptions = {
  providers: process.env.AUTH_ENABLE_EMAIL_PROVIDER === 'true'
    ? [
        EmailProvider({
          server: process.env.AUTH_EMAIL_SERVER ?? 'smtp://localhost:1025',
          from: process.env.AUTH_EMAIL_FROM ?? 'Roundtable <noreply@roundtable.local>',
        }),
      ]
    : process.env.NODE_ENV === 'production'
      ? []
      : [devLogin],
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
