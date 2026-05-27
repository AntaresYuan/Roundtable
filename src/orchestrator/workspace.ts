import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { WorkspaceResolver } from './nodes/dispatch.js';

export function workspaceResolver(rootDir: string): WorkspaceResolver {
  const root = resolve(rootDir);
  return {
    resolve(chatId: string): string {
      const safe = chatId.replace(/[^A-Za-z0-9_-]/g, '_');
      return join(root, safe);
    },
  };
}

export async function ensureWorkspace(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
