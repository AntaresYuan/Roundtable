/**
 * Dev-only demo seed (NOT the production seed — that plugs into scripts/seed.ts via
 * issue #35). Creates two visibly-distinct chats, each with a thread + artifacts, owned
 * by the user behind a given email, so switching tasks in the UI shows different content.
 *
 *   npx tsx scripts/dev-seed.ts [email]      # default: demo@roundtable.local
 *
 * The dev login (src/server/auth.ts) keys users by email, so log in with the SAME email
 * to see the seeded chats. Idempotent: re-running clears this script's own chats first
 * (those under workspaces/dev-seed/), never anyone else's.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { createDbClient } from '../src/db/client.js';
import {
  artifactKindEnum,
  artifacts,
  chats,
  messageAuthorTypeEnum,
  messages,
  users,
} from '../src/db/schema.js';

if (process.env['NODE_ENV'] === 'production') {
  throw new Error('dev-seed is not allowed in production');
}

type AuthorType = (typeof messageAuthorTypeEnum.enumValues)[number];
type ArtifactKind = (typeof artifactKindEnum.enumValues)[number];

type SeedChat = {
  title: string;
  slug: string;
  thread: { authorType: AuthorType; authorId: string | null; content: string }[];
  files: { kind: ArtifactKind; title: string; ownerAgentId: string; preview: string }[];
};

const SEED: SeedChat[] = [
  {
    title: 'Waitlist landing page',
    slug: 'waitlist-landing',
    thread: [
      { authorType: 'user', authorId: null, content: 'Build a waitlist landing page with an email capture form.' },
      { authorType: 'orchestrator', authorId: 'orchestrator', content: 'Planned 2 parallel tasks: Atlas on the page, Beam on the capture API.' },
      { authorType: 'agent', authorId: 'atlas', content: 'Scaffolded the hero + form in page.tsx — wired to /api/waitlist.' },
      { authorType: 'agent', authorId: 'beam', content: 'Shipped the waitlist API route with email validation.' },
    ],
    files: [
      { kind: 'code', title: 'app/page.tsx', ownerAgentId: 'atlas', preview: 'export default function Page() { /* hero + waitlist form */ }' },
      { kind: 'code', title: 'app/api/waitlist/route.ts', ownerAgentId: 'beam', preview: 'export async function POST(req) { /* validate + store email */ }' },
    ],
  },
  {
    title: 'Realtime chat feature',
    slug: 'realtime-chat',
    thread: [
      { authorType: 'user', authorId: null, content: 'Add a realtime chat panel with typing indicators.' },
      { authorType: 'orchestrator', authorId: 'orchestrator', content: 'Routed to Beam for the socket layer and Vera for an a11y review.' },
      { authorType: 'agent', authorId: 'beam', content: 'Added a WebSocket channel and a useChat() hook for live messages.' },
      { authorType: 'agent', authorId: 'vera', content: 'Reviewed: added aria-live to the message list and a visible typing label.' },
    ],
    files: [
      { kind: 'code', title: 'lib/useChat.ts', ownerAgentId: 'beam', preview: 'export function useChat(roomId) { /* ws subscribe + send */ }' },
      { kind: 'markdown', title: 'docs/chat-a11y.md', ownerAgentId: 'vera', preview: '# Chat accessibility\n- aria-live=polite on the log\n- typing label is text, not color' },
    ],
  },
];

async function main(): Promise<void> {
  const email = (process.argv[2] ?? process.env['SEED_EMAIL'] ?? 'demo@roundtable.local')
    .trim()
    .toLowerCase();
  const { db, client } = createDbClient();
  try {
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    let userId = found[0]?.id;
    if (!userId) {
      const inserted = await db
        .insert(users)
        .values({ id: randomUUID(), email })
        .returning({ id: users.id });
      userId = inserted[0]?.id;
    }
    if (!userId) throw new Error(`could not resolve a user id for ${email}`);

    // Idempotent: drop only this script's previously-seeded chats (cascade clears their
    // messages + artifacts), never the user's real chats.
    await db
      .delete(chats)
      .where(and(eq(chats.ownerUserId, userId), like(chats.workspacePath, 'workspaces/dev-seed/%')));

    for (const c of SEED) {
      const chatId = randomUUID();
      await db.insert(chats).values({
        id: chatId,
        ownerUserId: userId,
        title: c.title,
        workspacePath: `workspaces/dev-seed/${c.slug}-${chatId.slice(0, 8)}`,
      });
      await db.insert(messages).values(
        c.thread.map((m) => ({
          id: randomUUID(),
          chatId,
          authorType: m.authorType,
          authorId: m.authorId,
          content: m.content,
        })),
      );
      await db.insert(artifacts).values(
        c.files.map((a) => ({
          id: randomUUID(),
          chatId,
          kind: a.kind,
          title: a.title,
          ownerAgentId: a.ownerAgentId,
          currentVersion: 1,
          preview: a.preview,
        })),
      );
    }

    process.stdout.write(
      `${JSON.stringify({ email, userId, chats: SEED.length }, null, 2)}\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
