import { and, asc, eq } from 'drizzle-orm';
import type {
  AgentRoleId,
  Artifact,
  ArtifactRef,
  HandoffCard,
  HandoffContextAudit,
  HandoffContextSource,
  PinnedMessage,
  PlanTask,
} from '../contracts/index.js';
import type { Db } from '../db/index.js';
import {
  artifacts as persistedArtifacts,
  chats,
  messages,
  pinnedMessages,
  userProfiles,
  userSkills,
  workbenchPinnedMessages,
} from '../db/index.js';
import type { OrchestratorState } from './state.js';

const DEFAULT_CONTEXT_BUDGET_CHARS = 6_000;
const PIN_BUDGET_WEIGHT = 1;
const ARTIFACT_REF_WEIGHT = 80;
const REVIEW_COMMENT_WEIGHT = 240;
const PREVIOUS_CARD_WEIGHT = 320;
const COMPACT_PIN_CHARS = 280;

export interface HandoffContextInput {
  db?: Db;
  state: OrchestratorState;
  task: PlanTask;
  role: AgentRoleId;
  previousCards?: HandoffCard[];
  relevantArtifacts?: ArtifactRef[];
  maxChars?: number;
}

export interface ComposedHandoffContext {
  taskBrief: string;
  pinnedMessages: PinnedMessage[];
  relevantArtifacts: ArtifactRef[];
  contextAudit: HandoffContextAudit;
}

interface PinCandidate {
  message: PinnedMessage;
  scope: 'workbench' | 'chat';
  sourceId: string;
  label: string;
}

interface ContextCandidate {
  source: HandoffContextSource;
  apply(result: MutableContext, compact: boolean): void;
}

interface MutableContext {
  taskBrief: string;
  pinnedMessages: PinnedMessage[];
  relevantArtifacts: ArtifactRef[];
}

export async function composeHandoffContext(
  input: HandoffContextInput,
): Promise<ComposedHandoffContext> {
  const maxChars = input.maxChars ?? DEFAULT_CONTEXT_BUDGET_CHARS;
  const candidates: ContextCandidate[] = [
    userIntentCandidate(input),
    taskCandidate(input),
    ...(await userProfileCandidates(input)),
    ...(await userSkillCandidates(input)),
    ...previousCardCandidates(input.previousCards ?? []),
    ...reviewCommentCandidates(input),
    ...(await pinCandidates(input)),
    ...artifactCandidates(input),
  ];

  const result: MutableContext = {
    taskBrief: input.task.title,
    pinnedMessages: [],
    relevantArtifacts: [],
  };
  let usedChars = 0;
  let compacted = false;
  const sources: HandoffContextSource[] = [];

  for (const candidate of candidates) {
    const rawChars = candidate.source.chars;
    if (usedChars + rawChars <= maxChars) {
      candidate.apply(result, false);
      usedChars += rawChars;
      sources.push({ ...candidate.source, included: true, compacted: false });
      continue;
    }

    const compactChars = compactedChars(candidate.source);
    if (compactChars > 0 && usedChars + compactChars <= maxChars) {
      candidate.apply(result, true);
      usedChars += compactChars;
      compacted = true;
      sources.push({
        ...candidate.source,
        chars: compactChars,
        included: true,
        compacted: true,
      });
      continue;
    }

    sources.push({ ...candidate.source, included: false, compacted: false });
  }

  return {
    taskBrief: result.taskBrief,
    pinnedMessages: result.pinnedMessages,
    relevantArtifacts: result.relevantArtifacts,
    contextAudit: {
      budget: { maxChars, usedChars, compacted },
      sources,
    },
  };
}

async function userProfileCandidates(
  input: HandoffContextInput,
): Promise<ContextCandidate[]> {
  if (!input.db) return [];
  const [row] = await input.db
    .select({
      userId: chats.ownerUserId,
      defaultBrief: userProfiles.defaultBrief,
    })
    .from(chats)
    .leftJoin(userProfiles, eq(userProfiles.userId, chats.ownerUserId))
    .where(eq(chats.id, input.state.chatId));

  const defaultBrief = row?.defaultBrief?.trim();
  if (!row || !defaultBrief) return [];

  return [
    {
      source: {
        scope: 'user',
        kind: 'default_brief',
        id: row.userId,
        label: 'user preferences',
        chars: defaultBrief.length,
        included: false,
        compacted: false,
      },
      apply(result, compact) {
        result.taskBrief = appendSection(
          result.taskBrief,
          'User preferences',
          compact ? compactText(defaultBrief, COMPACT_PIN_CHARS) : defaultBrief,
        );
      },
    },
  ];
}

/**
 * Mount user-scoped skills (spec 100 L5 / #100) whose `trigger_hint` keyword-
 * matches against the current task title + user message. Deterministic and
 * audit-logged via `contextAudit.sources` — explicit alternative to RAG
 * recall (ADR-010).
 */
async function userSkillCandidates(
  input: HandoffContextInput,
): Promise<ContextCandidate[]> {
  if (!input.db) return [];

  const [chat] = await input.db
    .select({ ownerUserId: chats.ownerUserId })
    .from(chats)
    .where(eq(chats.id, input.state.chatId));
  if (!chat) return [];

  const skills = await input.db
    .select({
      id: userSkills.id,
      name: userSkills.name,
      triggerHint: userSkills.triggerHint,
      body: userSkills.body,
    })
    .from(userSkills)
    .where(eq(userSkills.ownerUserId, chat.ownerUserId));

  const haystack = [
    input.state.userMessage,
    input.task.title,
    input.task.assignee,
  ]
    .filter((s): s is string => typeof s === 'string')
    .join(' ')
    .toLowerCase();

  const matched = skills.filter((s) => matchesTrigger(s.triggerHint, haystack));

  return matched.map((skill) => {
    const text = `${skill.name}: ${skill.body}`;
    return {
      source: {
        scope: 'user' as const,
        kind: 'mounted_skill',
        id: skill.id,
        label: `skill: ${skill.name}`,
        chars: text.length,
        included: false,
        compacted: false,
      },
      apply(result, compact) {
        const value = compact ? compactText(text, COMPACT_PIN_CHARS) : text;
        result.taskBrief = appendSection(result.taskBrief, 'Mounted skill', value);
      },
    };
  });
}

function matchesTrigger(triggerHint: string, haystack: string): boolean {
  if (!triggerHint.trim()) return false;
  return triggerHint
    .split(/[,\n;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .some((kw) => haystack.includes(kw));
}

async function pinCandidates(input: HandoffContextInput): Promise<ContextCandidate[]> {
  const pins = input.db
    ? await loadScopedPins(input.db, input.state.chatId)
    : [];

  return pins.map((pin) => ({
    source: {
      scope: pin.scope,
      kind: 'pinned_message',
      id: pin.sourceId,
      label: pin.label,
      chars: pin.message.content.length * PIN_BUDGET_WEIGHT,
      included: false,
      compacted: false,
    },
    apply(result, compact) {
      if (result.pinnedMessages.length >= 10) return;
      result.pinnedMessages.push({
        ...pin.message,
        content: compact
          ? compactText(pin.message.content, COMPACT_PIN_CHARS)
          : pin.message.content,
      });
    },
  }));
}

async function loadScopedPins(db: Db, chatId: string): Promise<PinCandidate[]> {
  const [chat] = await db
    .select({ workbenchId: chats.workbenchId })
    .from(chats)
    .where(eq(chats.id, chatId));
  if (!chat) return [];

  const workbenchPins = await db
    .select({
      id: workbenchPinnedMessages.id,
      content: workbenchPinnedMessages.content,
      pinnedBy: workbenchPinnedMessages.pinnedByUserId,
    })
    .from(workbenchPinnedMessages)
    .where(eq(workbenchPinnedMessages.workbenchId, chat.workbenchId))
    .orderBy(asc(workbenchPinnedMessages.position));

  const chatPins = await db
    .select({
      id: pinnedMessages.id,
      content: messages.content,
      pinnedBy: pinnedMessages.pinnedByUserId,
    })
    .from(pinnedMessages)
    .innerJoin(
      messages,
      and(
        eq(messages.id, pinnedMessages.messageId),
        eq(messages.chatId, pinnedMessages.chatId),
      ),
    )
    .where(eq(pinnedMessages.chatId, chatId))
    .orderBy(asc(pinnedMessages.position));

  const chatSlice = chatPins.slice(0, 10);
  const workbenchSlice = workbenchPins.slice(0, 10 - chatSlice.length);

  return [
    ...workbenchSlice.map((pin): PinCandidate => ({
      message: { id: pin.id, content: pin.content, pinnedBy: pin.pinnedBy },
      scope: 'workbench',
      sourceId: pin.id,
      label: 'workbench pinned message',
    })),
    ...chatSlice.map((pin): PinCandidate => ({
      message: { id: pin.id, content: pin.content, pinnedBy: pin.pinnedBy },
      scope: 'chat',
      sourceId: pin.id,
      label: 'chat pinned message',
    })),
  ];
}

function artifactCandidates(input: HandoffContextInput): ContextCandidate[] {
  const refs = selectArtifactRefs(input);
  return refs.map((ref) => ({
    source: {
      scope: 'artifact',
      kind: 'artifact_ref',
      id: ref.id,
      label: ref.title,
      chars: artifactRefChars(ref),
      included: false,
      compacted: false,
    },
    apply(result) {
      if (!result.relevantArtifacts.some((existing) => existing.id === ref.id)) {
        result.relevantArtifacts.push(ref);
      }
    },
  }));
}

function selectArtifactRefs(input: HandoffContextInput): ArtifactRef[] {
  if (input.relevantArtifacts) return input.relevantArtifacts;
  if (input.role !== 'reviewer' && input.role !== 'fixer') return [];
  return latestArtifactRefs(input.state.artifacts);
}

export function latestArtifactRefs(artifacts: Artifact[]): ArtifactRef[] {
  const latest = new Map<string, Artifact>();
  for (const artifact of artifacts) {
    const prev = latest.get(artifact.id);
    if (!prev || artifact.version > prev.version) latest.set(artifact.id, artifact);
  }
  return Array.from(latest.values()).map((artifact) => ({
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    ...(artifact.uri !== undefined ? { uri: artifact.uri } : {}),
  }));
}

export async function loadWorkbenchArtifactsForChat(
  db: unknown,
  chatId: string,
): Promise<Artifact[]> {
  const scopedDb = db as Pick<Db, 'select'>;
  const [chat] = await scopedDb
    .select({ workbenchId: chats.workbenchId })
    .from(chats)
    .where(eq(chats.id, chatId));
  if (!chat) return [];

  const rows = await scopedDb
    .select({
      id: persistedArtifacts.id,
      kind: persistedArtifacts.kind,
      title: persistedArtifacts.title,
      ownerAgentId: persistedArtifacts.ownerAgentId,
      version: persistedArtifacts.currentVersion,
      uri: persistedArtifacts.uri,
      preview: persistedArtifacts.preview,
      createdAt: persistedArtifacts.createdAt,
    })
    .from(persistedArtifacts)
    .where(eq(persistedArtifacts.workbenchId, chat.workbenchId)) as Array<{
      id: string;
      kind: Artifact['kind'];
      title: string;
      ownerAgentId: string;
      version: number;
      uri: string | null;
      preview: string | null;
      createdAt: Date;
    }>;

  return rows.map((row) => ({
    id: row.id as Artifact['id'],
    kind: row.kind,
    title: row.title,
    ownerAgentId: row.ownerAgentId,
    version: row.version,
    ...(row.uri !== null ? { uri: row.uri } : {}),
    ...(row.preview !== null ? { preview: row.preview } : {}),
    createdAt: row.createdAt,
  }));
}

function userIntentCandidate(input: HandoffContextInput): ContextCandidate {
  const chars = input.state.userMessage.length;
  return {
    source: {
      scope: 'chat',
      kind: 'user_intent',
      id: input.state.chatId,
      label: 'current user request',
      chars,
      included: false,
      compacted: false,
    },
    apply() {
      // Already represented by HandoffCard.userIntent.
    },
  };
}

function taskCandidate(input: HandoffContextInput): ContextCandidate {
  return {
    source: {
      scope: 'chat',
      kind: 'task_brief',
      id: input.task.id,
      label: input.task.title,
      chars: input.task.title.length,
      included: false,
      compacted: false,
    },
    apply() {
      // Already represented by HandoffCard.taskBrief.
    },
  };
}

function previousCardCandidates(cards: HandoffCard[]): ContextCandidate[] {
  return cards.slice(-3).map((card) => ({
    source: {
      scope: 'handoff',
      kind: 'previous_handoff',
      id: card.id,
      label: `${card.from} to ${card.to}`,
      chars: PREVIOUS_CARD_WEIGHT,
      included: false,
      compacted: false,
    },
    apply() {
      // Previous cards are summarized by the handoff generator prompt.
    },
  }));
}

function reviewCommentCandidates(input: HandoffContextInput): ContextCandidate[] {
  if (input.role !== 'reviewer' && input.role !== 'fixer') return [];
  return input.state.reviewComments.map((comment) => ({
    source: {
      scope: 'review',
      kind: 'review_comment',
      id: comment.id,
      label: comment.body,
      chars: REVIEW_COMMENT_WEIGHT,
      included: false,
      compacted: false,
    },
    apply() {
      // Review comments are represented by task instructions today.
    },
  }));
}

function artifactRefChars(ref: ArtifactRef): number {
  return ref.title.length + (ref.uri?.length ?? 0) + ARTIFACT_REF_WEIGHT;
}

function compactedChars(source: HandoffContextSource): number {
  if (source.kind === 'pinned_message') {
    return Math.min(source.chars, COMPACT_PIN_CHARS);
  }
  if (source.kind === 'previous_handoff' || source.kind === 'review_comment') {
    return Math.floor(source.chars / 2);
  }
  return 0;
}

function compactText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function appendSection(base: string, heading: string, body: string): string {
  return `${base.trimEnd()}\n\n${heading}:\n${body.trim()}`;
}
