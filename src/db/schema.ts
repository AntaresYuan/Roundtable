import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentRoleId,
  Artifact,
  ArtifactKind,
  ArtifactRef,
  DepKind,
  HandoffCard,
  McpServerConfig,
  PinnedMessage,
  SessionBudget,
} from '../contracts/index.js';

export const agentRoleEnum = pgEnum('agent_role', [
  'architect',
  'planner',
  'implementer',
  'reviewer',
  'fixer',
]);

export const messageAuthorTypeEnum = pgEnum('message_author_type', [
  'user',
  'orchestrator',
  'agent',
  'system',
]);

export const messageStatusEnum = pgEnum('message_status', [
  'draft',
  'streaming',
  'completed',
  'failed',
]);

export const artifactKindEnum = pgEnum('artifact_kind', [
  'code',
  'file',
  'diff',
  'web_app',
  'markdown',
  'mermaid',
  'html',
  'spec',
  'doc',
  'preview',
  'note',
]);

export const depKindEnum = pgEnum('dep_kind', [
  'derives_from',
  'replaces',
  'references',
]);

export const agentSessionStatusEnum = pgEnum('agent_session_status', [
  'starting',
  'running',
  'completed',
  'failed',
  'interrupted',
]);

export const liveTurnStatusEnum = pgEnum('live_turn_status', [
  'done',
  'error',
]);

export const liveTurnApprovalStatusEnum = pgEnum('live_turn_approval_status', [
  'pending',
  'approved',
  'changes_requested',
]);

export const liveTurnDispatchStatusEnum = pgEnum('live_turn_dispatch_status', [
  'not_started',
  'running',
  'completed',
  'failed',
]);

export const handoffScenarioEnum = pgEnum('handoff_scenario', [
  'dispatch',
  'agent_handoff',
  'join_group',
  'cross_chat',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    name: text('name'),
    email: varchar('email', { length: 320 }).notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
  }),
);

export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  defaultBrief: text('default_brief').notNull().default(''),
  defaultSkills: text('default_skills')
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  notes: text('notes').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  defaultLanguage: text('default_language').notNull().default('auto'),
  defaultWorkflowId: uuid('default_workflow_id'),
  approvalMode: text('approval_mode').notNull().default('always_ask'),
  runStyle: text('run_style').notNull().default('balanced'),
  learnPreferenceSuggestions: boolean('learn_preference_suggestions')
    .notNull()
    .default(true),
  useSavedPreferencesInHandoffs: boolean('use_saved_preferences_in_handoffs')
    .notNull()
    .default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workbenches = pgTable(
  'workbenches',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    workspacePath: text('workspace_path').notNull(),
    activeWorkflowId: uuid('active_workflow_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerIdx: index('workbenches_owner_user_id_idx').on(table.ownerUserId),
    workspacePathIdx: uniqueIndex('workbenches_workspace_path_idx').on(
      table.workspacePath,
    ),
    activeWorkflowIdx: index('workbenches_active_workflow_id_idx').on(
      table.activeWorkflowId,
    ),
  }),
);

export const workflowOriginEnum = pgEnum('workflow_origin', [
  'builtin',
  'user',
  'fork',
]);

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey(),
    /** Null for built-ins or for user-saved workflows not yet bound to a workbench. */
    workbenchId: uuid('workbench_id').references(() => workbenches.id, {
      onDelete: 'cascade',
    }),
    /** Null for built-ins; the owning user for user-saved/fork workflows. */
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    description: text('description'),
    /** Full WorkflowSchema-shaped JSON (specs/090). */
    definition: jsonb('definition').$type<unknown>().notNull(),
    origin: workflowOriginEnum('origin').notNull().default('user'),
    fromWorkflowId: uuid('from_workflow_id'),
    version: integer('version').notNull().default(1),
    builtin: boolean('builtin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workbenchIdx: index('workflows_workbench_id_idx').on(table.workbenchId),
    ownerIdx: index('workflows_owner_user_id_idx').on(table.ownerUserId),
    builtinIdx: index('workflows_builtin_idx').on(table.builtin),
  }),
);

export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workbenchId: uuid('workbench_id')
      .notNull()
      .references(() => workbenches.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerIdx: index('chats_owner_user_id_idx').on(table.ownerUserId),
    workbenchIdx: index('chats_workbench_id_idx').on(table.workbenchId),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    authorType: messageAuthorTypeEnum('author_type').notNull(),
    authorId: text('author_id'),
    content: text('content').notNull(),
    status: messageStatusEnum('status').notNull().default('completed'),
    event: jsonb('event').$type<AgentEvent>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatCreatedIdx: index('messages_chat_id_created_at_idx').on(
      table.chatId,
      table.createdAt,
    ),
  }),
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey(),
    workbenchId: uuid('workbench_id')
      .notNull()
      .references(() => workbenches.id, { onDelete: 'cascade' }),
    createdInChatId: uuid('created_in_chat_id').references(() => chats.id, {
      onDelete: 'set null',
    }),
    kind: artifactKindEnum('kind').$type<ArtifactKind>().notNull(),
    title: text('title').notNull(),
    ownerAgentId: text('owner_agent_id').notNull(),
    currentVersion: integer('current_version').notNull().default(0),
    uri: text('uri'),
    preview: text('preview'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workbenchIdx: index('artifacts_workbench_id_idx').on(table.workbenchId),
    createdInChatIdx: index('artifacts_created_in_chat_id_idx').on(
      table.createdInChatId,
    ),
    ownerIdx: index('artifacts_owner_agent_id_idx').on(table.ownerAgentId),
  }),
);

export const artifactVersions = pgTable(
  'artifact_versions',
  {
    id: uuid('id').primaryKey(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    parentVersion: integer('parent_version'),
    snapshot: jsonb('snapshot').$type<Artifact>().notNull(),
    diff: text('diff'),
    createdByAgentId: text('created_by_agent_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    artifactVersionIdx: uniqueIndex(
      'artifact_versions_artifact_id_version_idx',
    ).on(table.artifactId, table.version),
    artifactIdx: index('artifact_versions_artifact_id_idx').on(
      table.artifactId,
    ),
  }),
);

export const artifactDeps = pgTable(
  'artifact_deps',
  {
    fromArtifactId: uuid('from_artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    toArtifactId: uuid('to_artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    kind: depKindEnum('kind').$type<DepKind>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.fromArtifactId, table.toArtifactId, table.kind],
    }),
    fromIdx: index('artifact_deps_from_artifact_id_idx').on(
      table.fromArtifactId,
    ),
    toIdx: index('artifact_deps_to_artifact_id_idx').on(table.toArtifactId),
    noSelfDep: check(
      'artifact_deps_no_self_dep',
      sql`${table.fromArtifactId} <> ${table.toArtifactId}`,
    ),
  }),
);

export const handoffs = pgTable(
  'handoffs',
  {
    id: uuid('id').primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    from: text('from_agent_id').notNull(),
    to: text('to_agent_id').notNull(),
    scenario: handoffScenarioEnum('scenario').notNull(),
    userIntent: text('user_intent').notNull(),
    taskBrief: text('task_brief').notNull(),
    pinnedMessages: jsonb('pinned_messages')
      .$type<PinnedMessage[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    rolesInGroup: jsonb('roles_in_group').notNull().default(sql`'[]'::jsonb`),
    relevantArtifacts: jsonb('relevant_artifacts')
      .$type<ArtifactRef[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    card: jsonb('card').$type<HandoffCard>().notNull(),
    fullHistoryRef: text('full_history_ref').notNull(),
    generatedBy: text('generated_by').notNull().default('orchestrator'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatCreatedIdx: index('handoffs_chat_id_created_at_idx').on(
      table.chatId,
      table.createdAt,
    ),
    targetIdx: index('handoffs_to_agent_id_idx').on(table.to),
  }),
);

export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: uuid('id').primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    adapterId: text('adapter_id').notNull(),
    role: agentRoleEnum('role').$type<AgentRoleId>().notNull(),
    cwd: text('cwd').notNull(),
    status: agentSessionStatusEnum('status').notNull().default('starting'),
    mcpServers: jsonb('mcp_servers').$type<McpServerConfig[]>(),
    allowedTools: jsonb('allowed_tools').$type<string[]>(),
    budget: jsonb('budget').$type<SessionBudget>(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => ({
    chatStartedIdx: index('agent_sessions_chat_id_started_at_idx').on(
      table.chatId,
      table.startedAt,
    ),
    adapterIdx: index('agent_sessions_adapter_id_idx').on(table.adapterId),
  }),
);

export const liveTurns = pgTable(
  'live_turns',
  {
    id: text('id').primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    status: liveTurnStatusEnum('status').notNull(),
    provider: text('provider'),
    model: text('model'),
    pmMessage: text('pm_message'),
    needsApproval: boolean('needs_approval'),
    approvalStatus: liveTurnApprovalStatusEnum('approval_status'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    dispatchStatus: liveTurnDispatchStatusEnum('dispatch_status'),
    dispatchAdapter: text('dispatch_adapter'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    dispatch: jsonb('dispatch').$type<unknown[]>(),
    artifacts: jsonb('artifacts').$type<Artifact[]>(),
    dispatchStage: text('dispatch_stage'),
    dispatchError: text('dispatch_error'),
    dispatchWorkspacePath: text('dispatch_workspace_path'),
    intake: jsonb('intake').$type<unknown>(),
    plan: jsonb('plan').$type<unknown>(),
    // The workbench's active workflow definition this turn ran under, plus the
    // projected stage-by-stage run state (workflowRunFromState). Null when the
    // turn fell back to the role/LLM planner (no workflow bound).
    workflow: jsonb('workflow').$type<unknown>(),
    workflowRun: jsonb('workflow_run').$type<unknown>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatCreatedIdx: index('live_turns_chat_id_created_at_idx').on(
      table.chatId,
      table.createdAt,
    ),
    statusIdx: index('live_turns_status_idx').on(table.status),
  }),
);

export const pinnedMessages = pgTable(
  'pinned_messages',
  {
    id: uuid('id').primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    pinnedByUserId: uuid('pinned_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatPositionIdx: uniqueIndex('pinned_messages_chat_position_idx').on(
      table.chatId,
      table.position,
    ),
    chatMessageIdx: uniqueIndex('pinned_messages_chat_message_idx').on(
      table.chatId,
      table.messageId,
    ),
    chatIdx: index('pinned_messages_chat_id_idx').on(table.chatId),
    positionCap: check(
      'pinned_messages_position_cap',
      sql`${table.position} >= 0 and ${table.position} < 10`,
    ),
  }),
);

/**
 * Workbench-level pinned constraints (spec 100 / #98). Project-wide rules
 * that auto-inject into every HandoffCard in this workbench. Unlike chat-level
 * pinned (which references a `messages` row), workbench pins carry free-form
 * `content` because they outlive any single chat.
 */
export const workbenchPinnedMessages = pgTable(
  'workbench_pinned_messages',
  {
    id: uuid('id').primaryKey(),
    workbenchId: uuid('workbench_id')
      .notNull()
      .references(() => workbenches.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    pinnedByUserId: uuid('pinned_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workbenchPositionIdx: uniqueIndex(
      'workbench_pinned_messages_workbench_position_idx',
    ).on(table.workbenchId, table.position),
    workbenchIdx: index('workbench_pinned_messages_workbench_id_idx').on(
      table.workbenchId,
    ),
    positionCap: check(
      'workbench_pinned_messages_position_cap',
      sql`${table.position} >= 0 and ${table.position} < 10`,
    ),
  }),
);

/**
 * User-scoped skill library (spec 100 L5 / #100). PM proposes saving useful
 * patterns from a chat as reusable skills; the user must explicitly save
 * (ADR-007 propose/confirm; no auto-save, no opaque RAG — ADR-010). Matched
 * into HandoffCards by keyword `trigger_hint` for v1.
 */
export const userSkills = pgTable(
  'user_skills',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    triggerHint: text('trigger_hint').notNull(),
    body: text('body').notNull(),
    /** Where the skill was first proposed/saved from (audit). Nullable: chat may be deleted. */
    sourceChatId: uuid('source_chat_id').references(() => chats.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerIdx: index('user_skills_owner_user_id_idx').on(table.ownerUserId),
    ownerNameIdx: uniqueIndex('user_skills_owner_name_idx').on(
      table.ownerUserId,
      table.name,
    ),
  }),
);

export const customAgents = pgTable(
  'custom_agents',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    role: agentRoleEnum('role').$type<AgentRoleId>(),
    avatar: text('avatar'),
    systemPrompt: text('system_prompt').notNull(),
    capabilities: jsonb('capabilities').$type<AgentCapabilities>().notNull(),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerIdx: index('custom_agents_owner_user_id_idx').on(table.ownerUserId),
  }),
);
