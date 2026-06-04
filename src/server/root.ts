import { agentsRouter } from './routers/agents.js';
import { aiRouter } from './routers/ai.js';
import { artifactsRouter } from './routers/artifacts.js';
import { chatsRouter } from './routers/chats.js';
import { handoffsRouter } from './routers/handoffs.js';
import { messagesRouter } from './routers/messages.js';
import { pinnedRouter } from './routers/pinned.js';
import { userProfileRouter } from './routers/user-profile.js';
import { userSkillsRouter } from './routers/user-skills.js';
import { workbenchPinnedRouter } from './routers/workbench-pinned.js';
import { workbenchesRouter } from './routers/workbenches.js';
import { workflowsRouter } from './routers/workflows.js';
import { createCallerFactory, createTRPCRouter } from './trpc.js';

export const appRouter = createTRPCRouter({
  agents: agentsRouter,
  ai: aiRouter,
  artifacts: artifactsRouter,
  chats: chatsRouter,
  handoffs: handoffsRouter,
  messages: messagesRouter,
  pinned: pinnedRouter,
  userProfile: userProfileRouter,
  userSkills: userSkillsRouter,
  workbenches: workbenchesRouter,
  workbenchPinned: workbenchPinnedRouter,
  workflows: workflowsRouter,
});

export const createCaller = createCallerFactory(appRouter);

export type AppRouter = typeof appRouter;
