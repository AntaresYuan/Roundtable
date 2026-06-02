import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { and, eq, type SQL } from 'drizzle-orm';
import type { AgentEvent, Artifact, ArtifactKind } from '../contracts/index.js';
import { artifactVersions, artifacts } from '../db/schema.js';
import type * as schema from '../db/schema.js';

interface ArtifactDb {
  select: () => {
    from: (table: typeof artifacts) => {
      where: (condition: SQL<unknown>) => {
        limit: (count: number) => Promise<(typeof artifacts.$inferSelect)[]>;
      };
    };
  };
  insert: (table: typeof artifacts) => {
    values: (value: typeof artifacts.$inferInsert) => Promise<unknown>;
  };
  update: (table: typeof artifacts) => {
    set: (value: Partial<typeof artifacts.$inferInsert>) => {
      where: (condition: SQL<unknown>) => Promise<unknown>;
    };
  };
}

interface ArtifactVersionDb {
  insert: (table: typeof artifactVersions) => {
    values: (value: typeof artifactVersions.$inferInsert) => Promise<unknown>;
  };
}

type RoundtableDb = ArtifactDb & ArtifactVersionDb & {
  _: { fullSchema: typeof schema };
};

type FileChangeEvent = Extract<AgentEvent, { type: 'file_change' }>;

export interface ArtifactWatcherContext {
  db: RoundtableDb;
  chatId: string;
  ownerAgentId: string;
}

interface PendingArtifactUnit {
  kind: ArtifactKind;
  title: string;
  uri: string;
  changes: FileChangeEvent[];
}

export class ArtifactWatcher {
  private readonly pending = new Map<string, FileChangeEvent[]>();

  constructor(private readonly ctx: ArtifactWatcherContext) {}

  async accept(event: AgentEvent): Promise<AgentEvent[]> {
    if (event.type === 'file_change') {
      const eventsForPath = this.pending.get(event.path) ?? [];
      eventsForPath.push(event);
      this.pending.set(event.path, eventsForPath);
      return [event];
    }

    if (event.type === 'done') {
      const artifactEvents = await this.flush();
      return [...artifactEvents, event];
    }

    return [event];
  }

  async flush(): Promise<AgentEvent[]> {
    const changes = [...this.pending.values()].flat();
    this.pending.clear();
    if (changes.length === 0) return [];

    const artifactsForChanges = await Promise.all(
      inferArtifactUnits(changes).map((unit) => persistArtifact(this.ctx, unit)),
    );

    return artifactsForChanges.map((artifact) => ({ type: 'artifact', artifact }));
  }
}

export async function watchArtifactEvents(
  events: readonly AgentEvent[],
  ctx: ArtifactWatcherContext,
): Promise<AgentEvent[]> {
  const watcher = new ArtifactWatcher(ctx);
  const output: AgentEvent[] = [];

  for (const event of events) {
    output.push(...(await watcher.accept(event)));
  }

  output.push(...(await watcher.flush()));
  return output;
}

function inferArtifactUnits(changes: readonly FileChangeEvent[]): PendingArtifactUnit[] {
  const webApp = inferWebAppUnit(changes);
  if (webApp) return [webApp];

  const changesByPath = new Map<string, FileChangeEvent[]>();
  for (const change of changes) {
    const eventsForPath = changesByPath.get(change.path) ?? [];
    eventsForPath.push(change);
    changesByPath.set(change.path, eventsForPath);
  }

  return [...changesByPath.entries()].map(([filePath, pathChanges]) => ({
    kind: inferArtifactKind(filePath),
    title: filePath,
    uri: filePath,
    changes: pathChanges,
  }));
}

function inferArtifactKind(filePath: string): ArtifactKind {
  const ext = path.posix.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.mdx') return 'markdown';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.mmd' || ext === '.mermaid') return 'mermaid';
  if (isSpecPath(filePath)) return 'spec';
  return 'code';
}

function inferWebAppUnit(
  changes: readonly FileChangeEvent[],
): PendingArtifactUnit | null {
  if (changes.length < 2) return null;

  const paths = changes.map((change) => change.path);
  if (!paths.some(isWebEntrypoint)) return null;

  const root = commonDirectory(paths);
  return {
    kind: 'web_app',
    title: root === '.' ? 'Web app' : root,
    uri: root,
    changes: [...changes],
  };
}

async function persistArtifact(
  ctx: ArtifactWatcherContext,
  unit: PendingArtifactUnit,
): Promise<Artifact> {
  const now = new Date();
  const lookupCondition = and(
    eq(artifacts.chatId, ctx.chatId),
    eq(artifacts.uri, unit.uri),
  );
  if (!lookupCondition) throw new Error('Unable to build artifact lookup condition.');

  const [existing] = await ctx.db
    .select()
    .from(artifacts)
    .where(lookupCondition)
    .limit(1);

  const artifactId = existing?.id ?? artifactIdFor(ctx.chatId, unit.uri);
  const parentVersion = existing?.currentVersion ?? null;
  const version = parentVersion === null ? 1 : parentVersion + 1;
  const artifact: Artifact = {
    id: artifactId as Artifact['id'],
    kind: unit.kind,
    title: unit.title,
    ownerAgentId: ctx.ownerAgentId,
    version,
    uri: unit.uri,
    createdAt: existing?.createdAt ?? now,
  };

  if (existing) {
    await ctx.db
      .update(artifacts)
      .set({
        kind: unit.kind,
        title: unit.title,
        ownerAgentId: ctx.ownerAgentId,
        currentVersion: version,
        updatedAt: now,
      })
      .where(eq(artifacts.id, artifactId));
  } else {
    await ctx.db.insert(artifacts).values({
      id: artifactId,
      chatId: ctx.chatId,
      kind: unit.kind,
      title: unit.title,
      ownerAgentId: ctx.ownerAgentId,
      currentVersion: version,
      uri: unit.uri,
      createdAt: now,
      updatedAt: now,
    });
  }

  await ctx.db.insert(artifactVersions).values({
    id: randomUUID(),
    artifactId,
    version,
    parentVersion,
    snapshot: artifact,
    diff: unit.changes.map(formatChangeDiff).join('\n\n'),
    createdByAgentId: ctx.ownerAgentId,
    createdAt: now,
  });

  return artifact;
}

function formatChangeDiff(change: FileChangeEvent): string {
  return [`# ${change.kind}: ${change.path}`, change.diff].join('\n');
}

function isSpecPath(filePath: string): boolean {
  return (
    filePath.startsWith('specs/') ||
    filePath.endsWith('.spec.ts') ||
    filePath.endsWith('.test.ts') ||
    filePath.endsWith('.spec.tsx') ||
    filePath.endsWith('.test.tsx')
  );
}

function isWebEntrypoint(filePath: string): boolean {
  return [
    'package.json',
    'index.html',
    'app/page.tsx',
    'app/layout.tsx',
    'pages/index.tsx',
    'src/main.tsx',
    'src/App.tsx',
  ].some((entrypoint) => filePath === entrypoint || filePath.endsWith(`/${entrypoint}`));
}

function commonDirectory(paths: readonly string[]): string {
  const dirs = paths.map((filePath) => path.posix.dirname(filePath).split('/'));
  const [first = []] = dirs;
  const parts: string[] = [];

  for (let idx = 0; idx < first.length; idx += 1) {
    const part = first[idx];
    if (part === undefined) break;
    if (dirs.every((dir) => dir[idx] === part)) parts.push(part);
    else break;
  }

  const root = parts.join('/');
  return root.length > 0 ? root : '.';
}

function artifactIdFor(chatId: string, uri: string): string {
  const digest = createHash('sha256')
    .update(`${chatId}:${uri}`)
    .digest();
  const versionByte = digest[6];
  const variantByte = digest[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error('Unable to generate artifact id digest.');
  }
  digest[6] = (versionByte & 0x0f) | 0x40;
  digest[8] = (variantByte & 0x3f) | 0x80;
  const hex = digest.toString('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
