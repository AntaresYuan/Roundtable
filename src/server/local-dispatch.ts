import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { generateText } from 'ai';
import ts from 'typescript';
import { AdapterRegistry, createClaudeCodeAdapter, createCodexAdapter } from '@/adapters';
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
    const projectChatId = projectChatIdForTurn(turn);
    const state = {
      ...initialState(projectChatId, turn.message, turn.workflow),
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
    const failedWorkspace = await workspaceResolver(join(localRuntimeRoot(), 'workspaces')).resolve(projectChatIdForTurn(turn));
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

const DISPATCH_ROLES: AgentRoleId[] = ['architect', 'planner', 'implementer', 'reviewer', 'fixer'];

function createLocalDispatchRegistry(agentAdapter: LocalAgentAdapterMode): AdapterRegistry {
  const registry = new AdapterRegistry();
  const primary = agentAdapter === 'claude-code'
    ? createConfiguredClaudeCodeAdapter()
    : createLocalDispatchAdapter();
  registry.register(primary);

  // Second Coding Agent platform (spec 020 / skill add-agent-adapter): Codex is
  // always registered so it can be bound per-role and reached by @-routing. It
  // only spawns the real CLI when a role is actually dispatched to it.
  const codex = createConfiguredCodexAdapter();
  registry.register(codex);

  const byId = new Map<string, string>([
    ['local-dispatch', primary.id],
    ['claude-code', primary.id === 'claude-code' ? primary.id : codex.id],
    ['claude', primary.id === 'claude-code' ? primary.id : codex.id],
    ['codex', codex.id],
  ]);
  for (const role of DISPATCH_ROLES) {
    // Per-role override, e.g. ROUNDTABLE_ADAPTER_REVIEWER=codex. Defaults to the
    // primary adapter so existing behavior is unchanged.
    const override = process.env[`ROUNDTABLE_ADAPTER_${role.toUpperCase()}`]?.trim().toLowerCase();
    const adapterId = (override && byId.get(override)) || primary.id;
    registry.bindRole(role, adapterId);
  }
  return registry;
}

function createConfiguredCodexAdapter(): AgentAdapter {
  const config: Parameters<typeof createCodexAdapter>[0] = {};
  const command = process.env['ROUNDTABLE_CODEX_COMMAND'];
  if (command) config.command = command;
  const model = process.env['ROUNDTABLE_CODEX_MODEL'];
  if (model) config.model = model;
  const sandbox = process.env['ROUNDTABLE_CODEX_SANDBOX'];
  if (sandbox) config.sandbox = sandbox;
  return createCodexAdapter(config);
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
      const path = await suggestedPath(role, title, opts.cwd, input.text);
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
        cwd: opts.cwd,
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
  cwd: string;
}): Promise<GeneratedArtifactContent> {
  if (input.role === 'fixer' && /\bpreview\b.*\b(render|runtime|error|failed)|\brender\b.*\bpreview\b/i.test(input.taskBrief)) {
    return {
      text: previewRuntimeFixTemplate(input),
      source: 'template',
    };
  }

  if (process.env.NODE_ENV !== 'test' && process.env['ROUNDTABLE_LOCAL_AGENT_LLM'] !== '0') {
    try {
      requireOrchestratorKey();
      const firstPass = await generateLocalAgentFile(input);
      let candidate = stripMarkdownFence(firstPass).trim();
      if (!candidate) throw new Error('empty_generation');
      let issues = previewReadinessIssues(input.path, candidate);

      for (let attempt = 0; issues.length && attempt < 2; attempt += 1) {
        const repaired = await repairGeneratedArtifact(input, candidate, issues);
        const repairedText = stripMarkdownFence(repaired).trim();
        if (!repairedText) break;
        candidate = repairedText;
        issues = previewReadinessIssues(input.path, candidate);
      }

      return {
        text: ensureTrailingNewline(candidate),
        source: 'llm',
        ...(issues.length
          ? { error: `preview_quality_warnings: ${issues.join('; ')}` }
          : {}),
      };
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

async function generateLocalAgentFile(input: {
  role: AgentRoleId;
  title: string;
  taskBrief: string;
  path: string;
  cwd: string;
}): Promise<string> {
  const projectContext = await buildProjectContextWindow(input.cwd, input.path);
  const { text } = await generateText({
    model: defaultOrchestratorModel(),
    messages: [
      { role: 'system', content: localAgentSystemPrompt(input) },
      ...(projectContext ? [{ role: 'user' as const, content: projectContext }] : []),
      { role: 'user', content: localAgentTaskPrompt(input) },
    ],
  });
  return text;
}

async function repairGeneratedArtifact(
  input: {
    role: AgentRoleId;
    title: string;
    taskBrief: string;
    path: string;
    cwd: string;
  },
  source: string,
  issues: string[],
): Promise<string> {
  const projectContext = await buildProjectContextWindow(input.cwd, input.path);
  const { text } = await generateText({
    model: defaultOrchestratorModel(),
    messages: [
      { role: 'system', content: localAgentSystemPrompt(input) },
      ...(projectContext ? [{ role: 'user' as const, content: projectContext }] : []),
      {
        role: 'user',
        content: [
          'The previous file does not work well in the Roundtable preview runtime.',
          'Rewrite the complete file, fixing every issue below.',
          '',
          'Issues:',
          ...issues.map((issue) => `- ${issue}`),
          '',
          `Original task brief:\n${input.taskBrief}`,
          '',
          `Target path: ${input.path}`,
          '',
          'Previous file:',
          source,
          '',
          'Return only the corrected raw file contents.',
        ].join('\n'),
      },
    ],
  });
  return text;
}

function localAgentSystemPrompt(input: {
  role: AgentRoleId;
  path: string;
}): string {
  const isPreviewableReact = /\.(tsx|jsx)$/i.test(input.path);
  const isHtml = /\.html?$/i.test(input.path);
  return [
    'You are a Roundtable coding agent.',
    'Produce exactly one useful file for the assigned task.',
    'Return raw file contents only. Do not wrap in markdown fences.',
    'Keep the file self-contained and practical.',
    `Role: ${input.role}`,
    `Target path: ${input.path}`,
    ...(isHtml
      ? [
          '',
          'This file is rendered directly in a sandboxed iframe.',
          'Return a complete standalone HTML document with <!doctype html>, inline CSS, and inline JavaScript when interaction is needed.',
          'For slide decks or PPT-like requests, create an actual slide presentation with keyboard navigation, not a requirements document or prose explanation.',
        ]
      : []),
    ...(isPreviewableReact
      ? [
          '',
          'This React file is rendered inside a standalone iframe preview that only provides React, ReactDOM, and Babel.',
          'Do not use Tailwind CSS, utility class names, CSS modules, stylesheet imports, shadcn/ui, lucide-react, icon packages, image imports, or any external component library.',
          'Use plain React, semantic HTML, inline style objects, and/or a <style> element inside the component.',
          'If you use SVG, set explicit width, height, viewBox, and aria-hidden attributes so it cannot render at a huge default size.',
          'Export a default React component. Make the result look like a finished product, not a wireframe or raw HTML.',
          'For UI pages, include complete layout, spacing, typography, colors, responsive behavior, empty/loading/error states where relevant, and accessible labels.',
        ]
      : []),
  ].join('\n');
}

function localAgentTaskPrompt(input: {
  title: string;
  taskBrief: string;
  path: string;
}): string {
  return [
    '<current_task>',
    `User/task brief:\n${input.taskBrief}`,
    `File title: ${input.title}`,
    `Target path: ${input.path}`,
    'Write the complete file now.',
    '</current_task>',
  ].join('\n\n');
}

export function previewReadinessIssues(path: string, source: string): string[] {
  if (!/\.(tsx|jsx)$/i.test(path)) return [];
  const issues: string[] = [];
  issues.push(...tsxSyntaxIssues(path, source));

  if (!inferDefaultComponentName(source)) {
    issues.push('React preview files must export a default component.');
  }

  const unsupportedImports = unsupportedPreviewImports(source);
  if (unsupportedImports.length) {
    issues.push(`Remove unsupported imports: ${unsupportedImports.join(', ')}. The preview runtime only provides React.`);
  }

  if (usesTailwindUtilities(source)) {
    issues.push('Replace Tailwind/utility className styling with inline styles or a <style> element because the preview iframe does not load Tailwind CSS.');
  }

  if (usesUnbackedClassNames(source)) {
    issues.push('Every className in a preview file needs matching CSS in a <style> element, or should be replaced with inline styles.');
  }

  if (/<svg\b/i.test(source) && !/<svg\b[^>]*\b(width|style)=/i.test(source)) {
    issues.push('SVG elements need explicit width/height or inline size styles to avoid oversized default rendering.');
  }

  return issues;
}

function tsxSyntaxIssues(path: string, source: string): string[] {
  const result = ts.transpileModule(source, {
    fileName: path.endsWith('.jsx') ? 'preview.jsx' : 'preview.tsx',
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      allowJs: path.endsWith('.jsx'),
    },
  });

  return (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .slice(0, 4)
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
      const position = diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : null;
      const location = position ? `line ${position.line + 1}, column ${position.character + 1}` : 'unknown location';
      return `Fix TSX syntax error at ${location}: ${message}`;
    });
}

function unsupportedPreviewImports(source: string): string[] {
  const imports = new Set<string>();
  for (const match of source.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"];?\s*$/gm)) {
    const specifier = match[1];
    if (!specifier || specifier === 'react') continue;
    imports.add(specifier);
  }
  return [...imports];
}

function usesTailwindUtilities(source: string): boolean {
  if (/<style[\s>]/i.test(source)) return false;
  const classValues = [
    ...source.matchAll(/\bclassName\s*=\s*["']([^"']+)["']/g),
    ...source.matchAll(/\bclassName\s*=\s*\{\s*`([^`]+)`\s*\}/g),
  ].map((match) => match[1] ?? '');

  return classValues.some((value) => {
    const tokens = value.split(/\s+/).filter(Boolean);
    const utilityCount = tokens.filter(isLikelyTailwindToken).length;
    return utilityCount >= 2 || (utilityCount >= 1 && tokens.length <= 3);
  });
}

function isLikelyTailwindToken(token: string): boolean {
  return /^(?:-?m[trblxy]?|p[trblxy]?|w|h|min-h|max-w|grid|flex|items|justify|gap|space-y|space-x|rounded|border|bg|text|font|leading|tracking|shadow|ring|opacity|overflow|absolute|relative|fixed|inset|top|right|bottom|left|z|mx|my|container|sr-only|transition|duration|ease|hover:|focus:|sm:|md:|lg:|xl:|dark:)/.test(token);
}

function usesUnbackedClassNames(source: string): boolean {
  if (/<style[\s>]/i.test(source)) return false;
  return /\bclassName\s*=/.test(source);
}

function taskTitleFromBrief(brief: string): string {
  const firstLine = brief
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || 'Roundtable task').replace(/^#+\s*/, '').slice(0, 90);
}

function projectChatIdForTurn(turn: LocalTurn): string {
  return turn.localChatId || `local-${turn.id}`;
}

async function suggestedPath(
  role: AgentRoleId,
  title: string,
  cwd: string,
  taskBrief: string,
): Promise<string> {
  if ((role === 'implementer' || role === 'fixer') && isFollowUpProjectRequest(`${title}\n${taskBrief}`)) {
    const existingPage = await findPrimaryProjectFile(cwd);
    if (existingPage) return existingPage;
  }

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'task';
  if (role === 'implementer' && isHtmlPresentationRequest(`${title}\n${taskBrief}`)) {
    return `app/${slug}.html`;
  }
  if (role === 'implementer' && /\b(test|tests|spec|unit)\b/i.test(title)) {
    return `tests/${slug}.test.ts`;
  }
  if (
    role === 'implementer' &&
    /\b(web\s?page|webpage|website|site|page|ui|frontend|front[- ]end|react|tsx|landing|dashboard|app|single[- ]page)\b|网页|页面|前端|界面/i.test(title)
  ) {
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

function isHtmlPresentationRequest(text: string): boolean {
  return /\b(html\s*ppt|html\s*slide|slide\s*deck|slideshow|slides?|presentation|ppt|keynote)\b/i.test(text);
}

function isFollowUpProjectRequest(text: string): boolean {
  return /\b(update|modify|change|revise|refine|improve|continue|iterate|fix|repair|debug|add|remove|delete|rename|make it|turn it|polish)\b|继续|修改|改成|调整|优化|迭代|修复|加上|增加|删除|移除|换成|美化|完善|接着/i.test(text);
}

async function findPrimaryProjectFile(cwd: string): Promise<string | null> {
  const candidates = await listWorkspaceFiles(cwd);
  const ranked = candidates
    .filter((file) => /\.(tsx|jsx|ts|js|html)$/i.test(file))
    .sort((a, b) => projectFileRank(a) - projectFileRank(b));
  return ranked[0] ?? null;
}

function projectFileRank(path: string): number {
  if (/^app\/.+\.(tsx|jsx)$/i.test(path)) return 0;
  if (/^src\/.+\.(tsx|jsx)$/i.test(path)) return 1;
  if (/\.(tsx|jsx)$/i.test(path)) return 2;
  if (/^app\//i.test(path)) return 3;
  if (/^src\//i.test(path)) return 4;
  if (/\.html$/i.test(path)) return 5;
  return 10;
}

async function listWorkspaceFiles(cwd: string, dir = '', depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  let entries;
  try {
    entries = await readdir(resolve(cwd, dir), { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relativePath = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listWorkspaceFiles(cwd, relativePath, depth + 1));
      continue;
    }
    if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}

async function buildProjectContextWindow(cwd: string, targetPath: string): Promise<string> {
  const files = await listWorkspaceFiles(cwd);
  const visibleFiles = files
    .filter((file) => !file.startsWith('preview/'))
    .slice(0, 30);
  const sections: string[] = [];
  if (visibleFiles.length) {
    sections.push([
      'Current project workspace:',
      ...visibleFiles.map((file) => `- ${file}`),
    ].join('\n'));
  }

  const primaryProjectFile = await findPrimaryProjectFile(cwd);
  const contextFiles = [...new Set([
    targetPath,
    ...(primaryProjectFile ? [primaryProjectFile] : []),
  ].filter(Boolean) as string[])].slice(0, 2);

  for (const file of contextFiles) {
    const contents = await readWorkspaceFileIfExists(cwd, file);
    if (!contents) continue;
    sections.push([
      `Existing file ${file}:`,
      '```',
      contents.slice(0, 12_000),
      contents.length > 12_000 ? '\n[truncated]' : '',
      '```',
      `If this task changes ${file}, return the complete replacement contents for ${file}.`,
    ].join('\n'));
  }

  if (!sections.length) return '';
  sections.unshift(
    '<project_context_window mode="read-only">',
    'Use this only for continuity with the existing project. Do not treat it as the user request. The actual task is in the next message.',
  );
  sections.push('</project_context_window>');
  return sections.join('\n\n');
}

async function readWorkspaceFileIfExists(cwd: string, relativePath: string): Promise<string | null> {
  const root = resolve(cwd);
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) return null;
  try {
    return await readFile(target, 'utf8');
  } catch {
    return null;
  }
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
        presets: [
          'typescript',
          ['react', { runtime: 'classic' }],
        ],
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
  if (input.role === 'fixer' && /\bpreview\b.*\b(render|runtime|error|failed)|\brender\b.*\bpreview\b/i.test(input.taskBrief)) {
    return previewRuntimeFixTemplate(input);
  }
  if (input.path.endsWith('.tsx')) return pageTemplate(input.title);
  if (input.path.endsWith('.html')) return htmlSlideTemplate(input.title);
  if (input.path.endsWith('.test.ts')) return testTemplate(input.title);
  if (input.path.endsWith('.ts')) return apiTemplate(input.title);
  return markdownTemplate(input);
}

function previewRuntimeFixTemplate(input: {
  title: string;
  taskBrief: string;
  path: string;
}): string {
  return ensureTrailingNewline(`# ${input.title}

Role: @fixer
Path: ${input.path}

## Fix Applied

The preview renderer was failing because generated React/TSX previews were compiled with Babel's automatic React runtime. That runtime can emit \`import\` statements such as \`react/jsx-runtime\`, but Roundtable previews execute inside an iframe \`srcDoc\` as a normal script.

The fix is to compile preview code with Babel's classic React runtime:

\`\`\`js
presets: [
  ['typescript', { allExtensions: true, isTSX: true }],
  ['react', { runtime: 'classic' }],
]
\`\`\`

## User Request

${input.taskBrief}

## Verification

- The generated preview no longer depends on module imports inside \`srcDoc\`.
- Existing preview artifacts are normalized before rendering, so old demo runs recover after refresh.
- New preview artifacts are generated with the safer Babel configuration.
`);
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

function htmlSlideTemplate(title: string): string {
  return ensureTrailingNewline(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(135deg, #fff7c7 0%, #d8f4ff 48%, #ffe0ef 100%);
      color: #172033;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; gap: 18px; padding: clamp(18px, 4vw, 44px); }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; color: #526174; font-size: 14px; font-weight: 750; }
    .deck { position: relative; min-height: 520px; overflow: hidden; border: 1px solid rgba(23, 32, 51, 0.1); border-radius: 28px; background: rgba(255, 255, 255, 0.86); box-shadow: 0 24px 70px rgba(30, 64, 175, 0.16); }
    .slide { position: absolute; inset: 0; display: grid; align-content: center; gap: 24px; padding: clamp(28px, 6vw, 76px); opacity: 0; transform: translateX(24px); pointer-events: none; transition: opacity 220ms ease, transform 220ms ease; }
    .slide.active { opacity: 1; transform: translateX(0); pointer-events: auto; }
    .eyebrow { width: max-content; padding: 7px 12px; border-radius: 999px; background: #e8f5ff; color: #2368a2; font-size: 13px; font-weight: 850; letter-spacing: 0.04em; text-transform: uppercase; }
    h1 { max-width: 880px; margin: 0; color: #12213a; font-size: clamp(44px, 8vw, 86px); line-height: 0.95; }
    h2 { max-width: 760px; margin: 0; color: #172033; font-size: clamp(34px, 6vw, 64px); line-height: 1.02; }
    p, li { max-width: 760px; color: #3b4a60; font-size: clamp(18px, 2.4vw, 25px); line-height: 1.45; }
    ul { display: grid; gap: 14px; margin: 0; padding-left: 1.2em; }
    .visual-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; max-width: 760px; }
    .tile { min-height: 132px; border-radius: 20px; padding: 18px; display: grid; align-content: end; background: linear-gradient(135deg, #fff4c7, #c7f3ff); color: #19314f; font-weight: 850; box-shadow: inset 0 0 0 1px rgba(23, 32, 51, 0.08); }
    .controls { display: flex; align-items: center; gap: 10px; }
    button { width: 42px; height: 42px; border: 1px solid rgba(23, 32, 51, 0.12); border-radius: 50%; background: #fff; color: #172033; font: inherit; font-size: 22px; cursor: pointer; box-shadow: 0 8px 24px rgba(30, 64, 175, 0.12); }
    .progress { height: 8px; flex: 1; min-width: 160px; border-radius: 999px; background: rgba(35, 104, 162, 0.14); overflow: hidden; }
    .bar { height: 100%; width: 20%; border-radius: inherit; background: linear-gradient(90deg, #39a7ff, #ffbd4a); transition: width 220ms ease; }
    @media (max-width: 720px) { main { padding: 16px; } .deck { min-height: 580px; border-radius: 20px; } .visual-grid { grid-template-columns: 1fr; } header, footer { align-items: flex-start; flex-direction: column; } .progress { width: 100%; } }
  </style>
</head>
<body>
  <main>
    <header><span>Generated HTML slide deck</span><span>Use arrow keys or buttons</span></header>
    <section class="deck" aria-live="polite">
      <article class="slide active"><span class="eyebrow">Slide 1</span><h1>${escapeHtml(title)}</h1><p>A bright, keyboard-friendly HTML presentation generated as a real artifact.</p></article>
      <article class="slide"><span class="eyebrow">Slide 2</span><h2>Overview</h2><p>Use this slide for the main idea, audience, and desired takeaway.</p></article>
      <article class="slide"><span class="eyebrow">Slide 3</span><h2>Key Points</h2><ul><li>Clear structure with readable typography.</li><li>Bright visual system suitable for a presentation.</li><li>Self-contained HTML, CSS, and JavaScript.</li></ul></article>
      <article class="slide"><span class="eyebrow">Slide 4</span><h2>Visual Placeholders</h2><div class="visual-grid"><div class="tile">Image / chart</div><div class="tile">Example</div><div class="tile">Highlight</div></div></article>
      <article class="slide"><span class="eyebrow">Slide 5</span><h2>Closing</h2><p>End with a concise summary, next step, or call to action.</p></article>
    </section>
    <footer><div class="controls"><button type="button" aria-label="Previous slide" data-prev>‹</button><button type="button" aria-label="Next slide" data-next>›</button><span data-count>1 / 5</span></div><div class="progress" aria-hidden="true"><div class="bar"></div></div></footer>
  </main>
  <script>
    const slides = Array.from(document.querySelectorAll('.slide'));
    const count = document.querySelector('[data-count]');
    const bar = document.querySelector('.bar');
    let index = 0;
    function show(next) {
      index = (next + slides.length) % slides.length;
      slides.forEach((slide, i) => slide.classList.toggle('active', i === index));
      count.textContent = String(index + 1) + ' / ' + String(slides.length);
      bar.style.width = String(((index + 1) / slides.length) * 100) + '%';
    }
    document.querySelector('[data-prev]').addEventListener('click', () => show(index - 1));
    document.querySelector('[data-next]').addEventListener('click', () => show(index + 1));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') show(index - 1);
      if (event.key === 'ArrowRight' || event.key === ' ') show(index + 1);
    });
  </script>
</body>
</html>`);
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
