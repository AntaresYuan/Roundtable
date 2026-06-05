import { mkdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { chats, workbenches } from '../db/schema.js';
import type { WorkspaceResolver } from './nodes/dispatch.js';

export function workspaceResolver(rootDir: string): WorkspaceResolver {
  const root = resolve(rootDir);
  return {
    resolve(chatId: string): string {
      const safe = chatId.replace(/[^A-Za-z0-9_-]/g, '_');
      return resolveWorkspacePath(root, safe);
    },
  };
}

export function workbenchWorkspaceResolver(
  db: Db,
  rootDir: string,
): WorkspaceResolver {
  const root = resolve(rootDir);
  return {
    async resolve(chatId: string): Promise<string> {
      const [row] = await db
        .select({ workspacePath: workbenches.workspacePath })
        .from(chats)
        .innerJoin(workbenches, eq(chats.workbenchId, workbenches.id))
        .where(eq(chats.id, chatId))
        .limit(1);

      if (!row) {
        throw new Error(`workspace not found for chat ${chatId}`);
      }
      return resolveWorkspacePath(root, row.workspacePath);
    },
  };
}

export async function ensureWorkspace(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function resolveWorkspacePath(root: string, workspacePath: string): string {
  const resolved = isAbsolute(workspacePath)
    ? resolve(workspacePath)
    : resolve(root, workspacePath);
  assertWorkspaceInsideRoot(root, resolved);
  return resolved;
}

export function assertWorkspaceInsideRoot(rootDir: string, workspacePath: string): void {
  const root = resolve(rootDir);
  const workspace = resolve(workspacePath);
  const rel = relative(root, workspace);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
    return;
  }
  throw new Error(`workspace path escapes root: ${workspace}`);
}
