import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { generateText } from 'ai';
import { AdapterRegistry, createClaudeCodeAdapter } from '@/adapters';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentRoleId,
  AgentSession,
  Artifact,
  SessionOpts,
  UserInput,
} from '@/contracts';
import type { ArtifactKind } from '@/contracts';
import { ArtifactIdSchema } from '@/contracts';
import { fileHandoffLog, initialState, workspaceResolver } from '@/orchestrator';
import { runDispatch } from '@/orchestrator/nodes/dispatch';
import { workflowRunFromState } from '@/orchestrator/workflow-run';
import {
  defaultOrchestratorModel,
  requireOrchestratorKey,
} from '@/orchestrator/llm';
import {
  getLiveTurn,
  handoffLogPath,
  localRuntimeRoot,
  updateLiveTurn,
  type LocalTurn,
} from '@/server/local-turn-store';
import {
  clearDispatchControl,
  registerDispatchControl,
  wasDispatchInterrupted,
} from '@/server/dispatch-control';

export const INTERRUPTED_BY_USER = 'interrupted_by_user';

const CAPABILITIES: AgentCapabilities = {
  streaming: true,
  toolUse: true,
  fileEdits: true,
  persistentSessions: false,
  mcp: false,
  multimodal: false,
};

type LocalAgentAdapterMode = 'local-dispatch' | 'claude-code';

export interface LocalDispatchOptions {
  agentAdapter?: string;
  /** Run the heavy dispatch in the background and return immediately with status 'running'. */
  background?: boolean;
}

export class LocalDispatchError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export async function dispatchApprovedLocalTurn(
  turnId: string,
  options: LocalDispatchOptions = {},
) {
  const turn = await getLiveTurn(turnId);
  if (!turn) throw new LocalDispatchError('turn_not_found', 404);
  if (!turn.plan || !turn.intake) throw new LocalDispatchError('turn_has_no_plan', 409);
  if (turn.approvalStatus !== 'approved') throw new LocalDispatchError('turn_not_approved', 409);
  if (turn.dispatchStatus === 'running') throw new LocalDispatchError('dispatch_already_running', 409);
  if (turn.dispatchStatus === 'completed' && turn.dispatch?.length) {
    if (turn.dispatchWorkspacePath && turn.plan) {
      const refreshedArtifacts = await collectDispatchArtifacts(
        turn.artifacts ?? [],
        turn.dispatch,
        turn.dispatchWorkspacePath,
        turn.plan.tasks,
      );
      const refreshedTurn = await updateLiveTurn(turn.id, (current) => ({
        ...current,
        artifacts: refreshedArtifacts,
      }));
      if (refreshedTurn) return toLocalDispatchResponse(refreshedTurn);
    }
    return toLocalDispatchResponse(turn);
  }

  await updateLiveTurn(turn.id, (current) => {
    const { dispatchError: _dispatchError, ...rest } = current;
    return {
      ...rest,
      dispatchStatus: 'running',
    };
  });

  if (options.background) {
    // Fire-and-forget: the heavy runDispatch continues on the event loop and
    // persists its own 'completed'/'failed' status to the turn store. The client
    // polls history for the result instead of holding a multi-minute request open.
    void executeDispatchWork(turn, options).catch(() => {
      // executeDispatchWork persists its own 'failed' status; nothing to do here.
    });
    return toLocalDispatchResponse({
      ...turn,
      dispatchStatus: 'running',
      dispatch: [],
      artifacts: turn.artifacts ?? [],
    });
  }
  return executeDispatchWork(turn, options);
}

async function executeDispatchWork(
  turn: LocalTurn,
  options: LocalDispatchOptions,
): Promise<ReturnType<typeof toLocalDispatchResponse>> {
  if (!turn.plan || !turn.intake) throw new LocalDispatchError('turn_has_no_plan', 409);
  const control = registerDispatchControl(turn.id);
  try {
    const agentAdapter = resolveLocalAgentAdapterMode(options.agentAdapter);
    const registry = createLocalDispatchRegistry(agentAdapter);
    const state = {
      ...initialState(`local-${turn.id}`, turn.message, turn.workflow),
      stage: 'dispatch' as const,
      intake: turn.intake,
      plan: turn.plan,
    };
    const runtimeRoot = localRuntimeRoot();
    const workspace = await workspaceResolver(join(runtimeRoot, 'workspaces')).resolve(state.chatId);
    const result = await runDispatch(state, {
      registry,
      workspaces: { resolve: () => workspace },
      handoffLog: fileHandoffLog(handoffLogPath()),
      control,
    });
    const interrupted = wasDispatchInterrupted(turn.id);
    const failed = result.dispatch.some((record) => record.status === 'failed');
    const artifacts = await collectDispatchArtifacts(
      result.artifacts,
      result.dispatch,
      workspace,
      turn.plan.tasks,
    );
    // Re-project stage states from the post-dispatch orchestrator state so the
    // workflow strip advances (done/active/blocked) as seats complete.
    const workflowRun = turn.workflow
      ? workflowRunFromState({ ...result })
      : undefined;
    const nextTurn = await updateLiveTurn(turn.id, (current) => ({
      ...current,
      dispatchAdapter: agentAdapter,
      dispatchStatus: interrupted || failed ? 'failed' : 'completed',
      dispatchedAt: new Date().toISOString(),
      dispatch: result.dispatch,
      artifacts,
      dispatchStage: interrupted ? 'interrupted' : result.stage,
      dispatchWorkspacePath: workspace,
      ...(workflowRun ? { workflowRun } : {}),
      ...(interrupted
        ? { dispatchError: INTERRUPTED_BY_USER }
        : failed
          ? { dispatchError: 'one_or_more_tasks_failed' }
          : {}),
    }));
    if (!nextTurn) throw new LocalDispatchError('turn_not_found', 404);
    return toLocalDispatchResponse(nextTurn);
  } catch (error) {
    if (error instanceof LocalDispatchError) throw error;
    const message = errorMessage(error);
    const failedWorkspace = await workspaceResolver(join(localRuntimeRoot(), 'workspaces')).resolve(`local-${turn.id}`);
    const failedTurn = await updateLiveTurn(turn.id, (current) => ({
      ...current,
      dispatchStatus: 'failed',
      dispatchAdapter: resolveLocalAgentAdapterMode(options.agentAdapter),
      dispatchedAt: new Date().toISOString(),
      dispatchStage: 'dispatch',
      dispatchError: message,
      dispatchWorkspacePath: failedWorkspace,
    }));
    if (!failedTurn) throw new LocalDispatchError('turn_not_found', 404);
    return toLocalDispatchResponse(failedTurn);
  } finally {
    clearDispatchControl(turn.id);
  }
}

export function toLocalDispatchResponse(turn: LocalTurn) {
  return {
    ok: true,
    id: turn.id,
    dispatchStatus: turn.dispatchStatus ?? 'not_started',
    ...(turn.dispatchAdapter ? { dispatchAdapter: turn.dispatchAdapter } : {}),
    records: turn.dispatch ?? [],
    artifacts: turn.artifacts ?? [],
    ...(turn.dispatchedAt ? { dispatchedAt: turn.dispatchedAt } : {}),
    ...(turn.dispatchStage ? { dispatchStage: turn.dispatchStage } : {}),
    ...(turn.dispatchError ? { dispatchError: turn.dispatchError } : {}),
    ...(turn.dispatchWorkspacePath ? { workspacePath: turn.dispatchWorkspacePath } : {}),
    ...(turn.workflowRun ? { workflowRun: turn.workflowRun } : {}),
  };
}

interface DispatchRecordWithEvents {
  taskId: string;
  events: AgentEvent[];
}

async function collectDispatchArtifacts(
  baseArtifacts: Artifact[],
  records: DispatchRecordWithEvents[],
  workspace: string,
  tasks: Array<{ id: string; title: string; assignee: string }>,
): Promise<Artifact[]> {
  const byKey = new Map<string, Artifact>();
  const changedPaths = new Set<string>();
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  const put = (artifact: Artifact) => {
    byKey.set(`${artifact.kind}:${artifact.title}`, artifact);
  };

  for (const artifact of baseArtifacts) {
    const relativePath = workspaceRelativePath(workspace, artifact.title)
      ?? (artifact.uri ? workspaceRelativePath(workspace, artifact.uri.replace(/^workspace:\/\//, '')) : null);
    if (!relativePath) {
      put(artifact);
      continue;
    }

    const text = artifact.preview ?? await readWorkspaceText(workspace, relativePath);
    put({
      ...artifact,
      kind: artifact.kind === 'file' ? inferArtifactKind(relativePath) : artifact.kind,
      title: relativePath,
      uri: `workspace://${relativePath}`,
      ...(text !== undefined ? { preview: text } : {}),
    });
    if (text !== undefined) {
      const preview = buildRunnablePreview(relativePath, text, relativePath);
      if (preview) {
        put({
          id: ArtifactIdSchema.parse(`preview-${slugFromPath(relativePath)}`),
          kind: 'preview',
          title: preview.path,
          ownerAgentId: artifact.ownerAgentId,
          version: 1,
          uri: `workspace://${preview.path}`,
          preview: preview.html,
          createdAt: new Date(),
        });
      }
    }
  }

  for (const record of records) {
    const existingArtifacts = record.events.filter((event) => event.type === 'artifact').length;
    const fileChanges = record.events.filter((event) => event.type === 'file_change').length;
    const text = record.events
      .filter((event): event is Extract<AgentEvent, { type: 'text_delta' }> => event.type === 'text_delta')
      .map((event) => event.delta)
      .join('\n')
      .trim();
    if (text && existingArtifacts === 0 && fileChanges === 0) {
      const task = tasksById.get(record.taskId);
      const ownerAgentId = roleFromAssignee(task?.assignee) ?? 'reviewer';
      const markdownPath = textArtifactPath(ownerAgentId, task?.title ?? record.taskId);
      await writeWorkspaceFile(workspace, markdownPath, ensureTrailingNewline(text));
      put({
        id: ArtifactIdSchema.parse(`text-${record.taskId}-${slugFromPath(markdownPath)}`),
        kind: 'markdown',
        title: markdownPath,
        ownerAgentId,
        version: 1,
        uri: `workspace://${markdownPath}`,
        preview: ensureTrailingNewline(text),
        createdAt: new Date(),
      });
    }

    for (const event of record.events) {
      if (event.type === 'file_change' && event.kind !== 'delete') {
        const relativePath = workspaceRelativePath(workspace, event.path);
        if (relativePath && !relativePath.startsWith('preview/')) changedPaths.add(relativePath);
      }
    }
  }

  for (const relativePath of changedPaths) {
    const text = await readWorkspaceText(workspace, relativePath);
    if (text === undefined) continue;
    const ownerAgentId = ownerForWorkspacePath(relativePath);
    put({
      id: ArtifactIdSchema.parse(`file-${slugFromPath(relativePath)}`),
      kind: inferArtifactKind(relativePath),
      title: relativePath,
      ownerAgentId,
      version: 1,
      uri: `workspace://${relativePath}`,
      preview: text,
      createdAt: new Date(),
    });

    const preview = buildRunnablePreview(relativePath, text, relativePath);
    if (preview) {
      await writeWorkspaceFile(workspace, preview.path, preview.html);
      put({
        id: ArtifactIdSchema.parse(`preview-${slugFromPath(relativePath)}`),
        kind: 'preview',
        title: preview.path,
        ownerAgentId,
        version: 1,
        uri: `workspace://${preview.path}`,
        preview: preview.html,
        createdAt: new Date(),
      });
    }
  }

  return [...byKey.values()];
}

function workspaceRelativePath(workspace: string, value: string): string | null {
  const root = resolve(workspace);
  const cleanValue = value.replace(/^workspace:\/\//, '');
  const target = isAbsolute(cleanValue) ? resolve(cleanValue) : resolve(root, cleanValue);
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.replace(/\\/g, '/');
}

async function readWorkspaceText(workspace: string, relativePath: string): Promise<string | undefined> {
  try {
    return await readFile(resolve(workspace, relativePath), 'utf8');
  } catch {
    return undefined;
  }
}

function ownerForWorkspacePath(path: string): AgentRoleId {
  if (path.startsWith('review/')) return 'reviewer';
  if (path.startsWith('docs/')) return 'architect';
  if (path.startsWith('fixes/')) return 'fixer';
  return 'implementer';
}

function roleFromAssignee(assignee: string | undefined): AgentRoleId | null {
  const role = assignee?.replace(/^@/, '');
  if (role === 'architect' || role === 'planner' || role === 'implementer' || role === 'reviewer' || role === 'fixer') {
    return role;
  }
  return null;
}

function textArtifactPath(role: AgentRoleId, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'agent-output';
  if (role === 'reviewer') return `review/${slug}.md`;
  if (role === 'architect' || role === 'planner') return `docs/${slug}.md`;
  if (role === 'fixer') return `fixes/${slug}.md`;
  return `work/${slug}.md`;
}

function createLocalDispatchRegistry(agentAdapter: LocalAgentAdapterMode): AdapterRegistry {
  const registry = new AdapterRegistry();
  const adapter = agentAdapter === 'claude-code'
    ? createConfiguredClaudeCodeAdapter()
    : createLocalDispatchAdapter();
  registry.register(adapter);
  for (const role of ['architect', 'planner', 'implementer', 'reviewer', 'fixer'] as AgentRoleId[]) {
    registry.bindRole(role, adapter.id);
  }
  return registry;
}

function resolveLocalAgentAdapterMode(valueOverride?: string): LocalAgentAdapterMode {
  const value = (valueOverride ?? process.env['ROUNDTABLE_AGENT_ADAPTER'] ?? process.env['ROUNDTABLE_DISPATCH_ADAPTER'] ?? '')
    .trim()
    .toLowerCase();
  return value === 'claude-code' || value === 'claude' ? 'claude-code' : 'local-dispatch';
}

function createConfiguredClaudeCodeAdapter(): AgentAdapter {
  return createClaudeCodeAdapter({
    command: process.env['ROUNDTABLE_CLAUDE_COMMAND'] || 'claude',
    extraArgs: claudeCodeExtraArgs(),
    isolateConfig: parseBoolean(process.env['ROUNDTABLE_CLAUDE_ISOLATE_CONFIG'], false),
  });
}

function claudeCodeExtraArgs(): string[] {
  const args: string[] = [];
  const model = process.env['ROUNDTABLE_CLAUDE_MODEL'];
  if (model) args.push('--model', model);
  args.push('--permission-mode', process.env['ROUNDTABLE_CLAUDE_PERMISSION_MODE'] || 'bypassPermissions');
  const rawExtra = process.env['ROUNDTABLE_CLAUDE_EXTRA_ARGS'];
  if (rawExtra) args.push(...rawExtra.split(/\s+/).filter(Boolean));
  return args;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function createLocalDispatchAdapter(): AgentAdapter {
  return {
    id: 'local-dispatch',
    displayName: 'Local Dispatch Agent',
    avatar: 'L',
    capabilities: CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSession> {
      return createLocalSession(opts);
    },
  };
}

function createLocalSession(opts: SessionOpts): AgentSession {
  const sessionId = opts.sessionId ?? randomUUID();
  let interrupted = false;
  return {
    id: sessionId,
    adapterId: 'local-dispatch',
    cwd: opts.cwd,
    async *send(input: UserInput): AsyncIterable<AgentEvent> {
      if (interrupted) {
        yield { type: 'error', message: 'interrupted', recoverable: false };
        return;
      }
      const role = opts.role;
      const title = taskTitleFromBrief(input.text);
      const path = suggestedPath(role, title);
      const toolId = `tool-${sessionId}`;
      yield { type: 'thinking_delta', delta: `${opts.agentMeta.displayName} received the handoff.` };
      yield {
        type: 'tool_use',
        id: toolId,
        name: 'local_generate_artifact',
        input: { role, path, title },
      };
      const content = await generateArtifactContent({
        role,
        title,
        taskBrief: input.text,
        path,
      });
      yield {
        type: 'tool_result',
        id: toolId,
        output: {
          path,
          source: content.source,
          bytes: content.text.length,
          ...(content.error ? { error: content.error } : {}),
        },
        ...(content.error ? { isError: true } : {}),
      };
      await writeWorkspaceFile(opts.cwd, path, content.text);
      const preview = buildRunnablePreview(path, content.text, title);
      if (preview) {
        await writeWorkspaceFile(opts.cwd, preview.path, preview.html);
      }
      yield {
        type: 'file_change',
        path,
        kind: 'edit',
        diff: content.text
          .split('\n')
          .slice(0, 24)
          .map((line) => `+ ${line}`)
          .join('\n'),
      };
      yield {
        type: 'artifact',
        artifact: {
          id: ArtifactIdSchema.parse(`local-${role}-${sessionId}`),
          kind: inferArtifactKind(path),
          title: path,
          ownerAgentId: role,
          version: 1,
          uri: `workspace://${path}`,
          preview: content.text,
          createdAt: new Date(),
        },
      };
      if (preview) {
        yield {
          type: 'file_change',
          path: preview.path,
          kind: 'edit',
          diff: preview.html
            .split('\n')
            .slice(0, 24)
            .map((line) => `+ ${line}`)
            .join('\n'),
        };
        yield {
          type: 'artifact',
          artifact: {
            id: ArtifactIdSchema.parse(`local-preview-${sessionId}`),
            kind: 'preview',
            title: preview.path,
            ownerAgentId: role,
            version: 1,
            uri: `workspace://${preview.path}`,
            preview: preview.html,
            createdAt: new Date(),
          },
        };
      }
      yield { type: 'text_delta', delta: `Completed local dispatch for ${title}.` };
      yield {
        type: 'done',
        finishReason: 'stop',
        usage: { inputTokens: Math.ceil(input.text.length / 4), outputTokens: 48 },
      };
    },
    async interrupt(): Promise<void> {
      interrupted = true;
    },
    async close(): Promise<void> {
      interrupted = true;
    },
  };
}

interface GeneratedArtifactContent {
  text: string;
  source: 'llm' | 'template';
  error?: string;
}

async function generateArtifactContent(input: {
  role: AgentRoleId;
  title: string;
  taskBrief: string;
  path: string;
}): Promise<GeneratedArtifactContent> {
  if (process.env.NODE_ENV !== 'test' && process.env['ROUNDTABLE_LOCAL_AGENT_LLM'] !== '0') {
    try {
      requireOrchestratorKey();
      const { text } = await generateText({
        model: defaultOrchestratorModel(),
        system: [
          'You are a Roundtable coding agent.',
          'Produce exactly one useful file for the assigned task.',
          'Return raw file contents only. Do not wrap in markdown fences.',
          'Keep the file self-contained and practical.',
          `Role: ${input.role}`,
          `Target path: ${input.path}`,
        ].join('\n'),
        prompt: [
          `User/task brief:\n${input.taskBrief}`,
          `File title: ${input.title}`,
          'Write the complete file now.',
        ].join('\n\n'),
      });
      const trimmed = stripMarkdownFence(text).trim();
      if (trimmed) return { text: ensureTrailingNewline(trimmed), source: 'llm' };
    } catch (error) {
      return {
        text: templateArtifactContent(input),
        source: 'template',
        error: errorMessage(error),
      };
    }
  }

  return {
    text: templateArtifactContent(input),
    source: 'template',
  };
}

function taskTitleFromBrief(brief: string): string {
  const firstLine = brief
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || 'Roundtable task').replace(/^#+\s*/, '').slice(0, 90);
}

function suggestedPath(role: AgentRoleId, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'task';
  if (role === 'implementer' && /\b(test|tests|spec|unit)\b/i.test(title)) {
    return `tests/${slug}.test.ts`;
  }
  if (role === 'implementer' && /\b(page|ui|frontend|react|tsx|landing|single[- ]page)\b/i.test(title)) {
    return `app/${slug}.tsx`;
  }
  if (role === 'implementer' && /\b(api|endpoint|route|server|backend)\b/i.test(title)) {
    return `src/${slug}.ts`;
  }
  if (role === 'reviewer') return `review/${slug}.md`;
  if (role === 'architect' || role === 'planner') return `docs/${slug}.md`;
  if (role === 'fixer') return `fixes/${slug}.md`;
  return `work/${slug}.md`;
}

function inferArtifactKind(path: string): ArtifactKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.mmd') || lower.endsWith('.mermaid')) return 'mermaid';
  if (lower.includes('/specs/') || lower.startsWith('specs/')) return 'spec';
  return 'code';
}

function buildRunnablePreview(
  path: string,
  source: string,
  title: string,
): { path: string; html: string } | null {
  if (!/\.(tsx|jsx)$/i.test(path)) return null;
  const componentName = inferDefaultComponentName(source);
  if (!componentName) return null;
  const executableSource = stripReactModuleShell(source);
  const runnableSource = escapeScriptContent(`const {
  createContext,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} = React;

${executableSource}

ReactDOM.createRoot(document.getElementById('root')).render(<${componentName} />);`);
  const previewPath = `preview/${slugFromPath(path)}.html`;
  return {
    path: previewPath,
    html: ensureTrailingNewline(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    html, body, #root { min-height: 100%; margin: 0; }
    body { background: #f8fafc; color: #0f172a; }
    button, input, textarea, select { font: inherit; }
    .preview-error {
      margin: 24px;
      padding: 16px;
      border: 1px solid #fecaca;
      border-radius: 8px;
      background: #fef2f2;
      color: #991b1b;
      font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: pre-wrap;
    }
  </style>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script id="preview-source" type="text/plain">${runnableSource}</script>
  <script>
    try {
      const source = document.getElementById('preview-source').textContent;
      const compiled = Babel.transform(source, {
        filename: 'preview.tsx',
        presets: ['typescript', 'react'],
      }).code;
      (0, eval)(compiled);
    } catch (error) {
      const root = document.getElementById('root');
      root.innerHTML = '<pre class="preview-error"></pre>';
      root.querySelector('.preview-error').textContent =
        'Preview failed to render:\\n' + (error && (error.stack || error.message) || String(error));
      throw error;
    }
  </script>
</body>
</html>`),
  };
}

function inferDefaultComponentName(source: string): string | null {
  const functionDefault = /export\s+default\s+function\s+([A-Za-z_$][\w$]*)/.exec(source);
  if (functionDefault?.[1]) return functionDefault[1];
  const namedDefault = /export\s+default\s+(?!function\b)([A-Za-z_$][\w$]*)\s*;?/.exec(source);
  if (namedDefault?.[1]) return namedDefault[1];
  const component = /(?:const|function)\s+([A-Z][A-Za-z0-9_$]*)\b/.exec(source);
  return component?.[1] ?? null;
}

function stripReactModuleShell(source: string): string {
  return source
    .replace(/^\s*import\s+React(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]react['"];?\s*$/gm, '')
    .replace(/^\s*import\s+\{[^}]*\}\s+from\s+['"]react['"];?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s+[^\n;]+;?\s*$/gm, '')
    .replace(/export\s+default\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+(?!function\b)([A-Za-z_$][\w$]*)\s*;?/g, '')
    .replace(/^export\s+(?=(function|const|let|var|class)\b)/gm, '')
    .replace(/([A-Za-z_$][\w$]*)!\./g, '$1.')
    .replace(/([A-Za-z_$][\w$]*)!\[/g, '$1[');
}

function slugFromPath(path: string): string {
  return path
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'preview';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeScriptContent(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script');
}

async function writeWorkspaceFile(cwd: string, relativePath: string, contents: string): Promise<void> {
  const root = resolve(cwd);
  const target = resolve(root, relativePath);
  // Separator-agnostic containment check: a hardcoded `${root}/` prefix never
  // matches on Windows, where resolve() yields backslash-separated paths.
  const rel = relative(root, target);
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error(`refusing to write outside workspace: ${relativePath}`);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

function templateArtifactContent(input: {
  role: AgentRoleId;
  title: string;
  taskBrief: string;
  path: string;
}): string {
  if (input.path.endsWith('.tsx')) return pageTemplate(input.title);
  if (input.path.endsWith('.test.ts')) return testTemplate(input.title);
  if (input.path.endsWith('.ts')) return apiTemplate(input.title);
  return markdownTemplate(input);
}

function pageTemplate(title: string): string {
  return ensureTrailingNewline(`import React, { useMemo, useState } from 'react';

type Todo = {
  id: number;
  title: string;
  done: boolean;
};

export default function GeneratedTodoPage() {
  const [items, setItems] = useState<Todo[]>([
    { id: 1, title: 'Capture the workflow requirement', done: true },
    { id: 2, title: 'Dispatch implementation agents', done: true },
    { id: 3, title: 'Review the final artifact', done: false },
  ]);
  const [draft, setDraft] = useState('');
  const completeCount = useMemo(() => items.filter((item) => item.done).length, [items]);

  const addItem = () => {
    const value = draft.trim();
    if (!value) return;
    setItems((current) => [...current, { id: Date.now(), title: value, done: false }]);
    setDraft('');
  };

  return (
    <main style={{ maxWidth: 760, margin: '48px auto', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <p style={{ color: '#546179', fontSize: 13, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase' }}>
        Roundtable generated page
      </p>
      <h1 style={{ margin: '8px 0 12px', fontSize: 38, lineHeight: 1.1 }}>{${JSON.stringify(title)}}</h1>
      <p style={{ color: '#546179', fontSize: 16 }}>
        {completeCount} of {items.length} workflow tasks are complete.
      </p>
      <div style={{ display: 'flex', gap: 8, margin: '28px 0' }}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') addItem(); }}
          placeholder="Add a follow-up task"
          style={{ flex: 1, padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: 8 }}
        />
        <button onClick={addItem} style={{ padding: '12px 16px', border: 0, borderRadius: 8, background: '#2563eb', color: 'white', fontWeight: 700 }}>
          Add
        </button>
      </div>
      <section style={{ display: 'grid', gap: 10 }}>
        {items.map((item) => (
          <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <input
              type="checkbox"
              checked={item.done}
              onChange={() => setItems((current) => current.map((candidate) => (
                candidate.id === item.id ? { ...candidate, done: !candidate.done } : candidate
              )))}
            />
            <span style={{ textDecoration: item.done ? 'line-through' : 'none', color: item.done ? '#64748b' : '#0f172a' }}>
              {item.title}
            </span>
          </label>
        ))}
      </section>
    </main>
  );
}`);
}

function apiTemplate(title: string): string {
  return ensureTrailingNewline(`export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

const todos = new Map<string, TodoItem>();

export function listTodos(): TodoItem[] {
  return Array.from(todos.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createTodo(title: string): TodoItem {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error('title_required');
  const item: TodoItem = {
    id: crypto.randomUUID(),
    title: cleanTitle,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  todos.set(item.id, item);
  return item;
}

export function completeTodo(id: string): TodoItem {
  const item = todos.get(id);
  if (!item) throw new Error('todo_not_found');
  const next = { ...item, completed: true };
  todos.set(id, next);
  return next;
}

export const generatedTaskTitle = ${JSON.stringify(title)};
`);
}

function testTemplate(title: string): string {
  return ensureTrailingNewline(`import { describe, expect, it } from 'vitest';
import { completeTodo, createTodo, listTodos } from '../src/implement-todo-api-endpoints';

describe(${JSON.stringify(title)}, () => {
  it('creates and completes todo items', () => {
    const item = createTodo('Ship the generated workflow result');

    expect(listTodos()).toContainEqual(item);
    expect(completeTodo(item.id)).toMatchObject({
      id: item.id,
      completed: true,
    });
  });
});
`);
}

function markdownTemplate(input: {
  role: AgentRoleId;
  title: string;
  taskBrief: string;
  path: string;
}): string {
  return ensureTrailingNewline(`# ${input.title}

Role: @${input.role}
Path: ${input.path}

## Result

This task was executed by the local Roundtable agent dispatcher and materialized
as a real workspace artifact.

## Task Brief

${input.taskBrief}

## Acceptance Checks

- The task has a persisted dispatch record.
- The workspace contains this file.
- The artifact preview in the turn store matches the file contents.
`);
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return match ? match[1]! : text;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'dispatch_failed';
}
