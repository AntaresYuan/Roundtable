import { agentsRouter } from './routers/agents.js';
import { artifactsRouter } from './routers/artifacts.js';
import { chatsRouter } from './routers/chats.js';
import { handoffsRouter } from './routers/handoffs.js';
import { messagesRouter } from './routers/messages.js';
import { pinnedRouter } from './routers/pinned.js';
import { workbenchesRouter } from './routers/workbenches.js';
import { createCallerFactory, createTRPCRouter } from './trpc.js';

export const appRouter = createTRPCRouter({
  agents: agentsRouter,
  artifacts: artifactsRouter,
  chats: chatsRouter,
  handoffs: handoffsRouter,
  messages: messagesRouter,
  pinned: pinnedRouter,
  workbenches: workbenchesRouter,
});

export const createCaller = createCallerFactory(appRouter);

export type AppRouter = typeof appRouter;
