'use client';
/* Phase 3 smoke probe — verifies the live tRPC pipe end-to-end (auth → /api/trpc →
   Postgres). Not part of the product UI; delete once the real read-path (P3.2) lands. */
import { useSession, signIn, signOut } from 'next-auth/react';
import { trpc } from '@/ui/lib/trpc';

const btn = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #ccc',
  background: '#fff',
  cursor: 'pointer',
  font: 'inherit',
} as const;

export default function DevPage() {
  const { data: session, status } = useSession();
  const authed = status === 'authenticated';
  const chats = trpc.chats.list.useQuery(undefined, { enabled: authed });
  const utils = trpc.useUtils();
  const create = trpc.chats.create.useMutation({
    onSuccess: () => utils.chats.list.invalidate(),
  });

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22 }}>Phase 3 — live tRPC probe</h1>

      <section style={{ margin: '20px 0', padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h2 style={{ fontSize: 14, color: '#666' }}>Auth</h2>
        <p>status: <b>{status}</b>{session?.user?.email ? ` · ${session.user.email}` : ''}</p>
        {authed
          ? <button style={btn} onClick={() => signOut()}>Sign out</button>
          : <button style={btn} onClick={() => signIn()}>Sign in</button>}
      </section>

      <section style={{ margin: '20px 0', padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h2 style={{ fontSize: 14, color: '#666' }}>chats.list (live query)</h2>
        {!authed && <p style={{ color: '#999' }}>sign in to query</p>}
        {authed && chats.isLoading && <p>loading…</p>}
        {authed && chats.error && <p style={{ color: 'crimson' }}>error: {chats.error.message}</p>}
        {authed && chats.data && (
          <>
            <p>{chats.data.length} chat(s):</p>
            <ul>{chats.data.map((c) => <li key={c.id}>{c.title} <code>{c.workspacePath}</code></li>)}</ul>
            <button
              style={btn}
              disabled={create.isPending}
              onClick={() => create.mutate({ title: 'Test chat', workspacePath: `workspaces/test-${Date.now()}` })}
            >
              {create.isPending ? 'creating…' : '+ create test chat'}
            </button>
            {create.error && <p style={{ color: 'crimson' }}>{create.error.message}</p>}
          </>
        )}
      </section>
    </main>
  );
}
