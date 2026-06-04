import { randomUUID } from 'node:crypto';
import { generateObject, type LanguageModel } from 'ai';
import type {
  AgentRoleId,
  ArtifactRef,
  HandoffCard,
  HandoffContextAudit,
  PinnedMessage,
  PlanTask,
} from '../contracts/index.js';
import { HandoffCardSchema } from '../contracts/index.js';
import type { OrchestratorState } from './state.js';

const MAX_PINNED_MESSAGES = 10;
const MAX_RECENT_CARDS = 3;
const MAX_SYSTEM_PROMPT_CHARS = 32_000;

export interface HandoffGeneratorInput {
  state: OrchestratorState;
  task: PlanTask;
  role: AgentRoleId;
  pinnedMessages?: PinnedMessage[];
  relevantArtifacts?: ArtifactRef[];
  contextAudit?: HandoffContextAudit;
  previousCards?: HandoffCard[];
}

export interface HandoffModelClient {
  generate(input: HandoffGeneratorInput): Promise<unknown>;
}

export interface HandoffGeneratorOptions {
  modelClient?: HandoffModelClient;
}

export async function generateHandoffCard(
  input: HandoffGeneratorInput,
  opts: HandoffGeneratorOptions = {},
): Promise<HandoffCard> {
  const fallback = fallbackHandoffCard(input);

  if (!opts.modelClient) {
    return validateHandoffCard(fallback);
  }

  const first = await tryGenerate(input, opts.modelClient, fallback);
  if (first.ok) return first.card;

  const retry = await tryGenerate(
    {
      ...input,
      previousCards: summarizePreviousCards(input.previousCards ?? []),
    },
    opts.modelClient,
    fallback,
  );
  if (retry.ok) return retry.card;

  return validateHandoffCard(fallback);
}

export function fallbackHandoffCard(input: HandoffGeneratorInput): HandoffCard {
  return {
    id: randomUUID(),
    from: 'orchestrator',
    to: input.role,
    scenario: 'dispatch',
    userIntent: oneSentence(input.state.intake?.userVisibleSummary ?? input.state.userMessage),
    taskBrief: input.task.title,
    pinnedMessages: capPinnedMessages(input.pinnedMessages ?? []),
    rolesInGroup: [],
    relevantArtifacts: input.relevantArtifacts ?? [],
    ...(input.contextAudit ? { contextAudit: input.contextAudit } : {}),
    fullHistoryRef: `chat:${input.state.chatId}`,
    createdAt: new Date(),
    generatedBy: 'orchestrator',
  };
}

export function createAISDKHandoffModelClient(model: LanguageModel): HandoffModelClient {
  return {
    async generate(input: HandoffGeneratorInput): Promise<unknown> {
      const result = await generateObject({
        model,
        schema: HandoffCardSchema,
        system:
          'Generate a valid Roundtable HandoffCard JSON object. References only; never inline full history or artifact contents.',
        prompt: JSON.stringify(toPromptPayload(input)),
      });
      return result.object;
    },
  };
}

export function buildHandoffSystemPrompt(card: HandoffCard): string {
  const payload = {
    handoff: {
      id: card.id,
      from: card.from,
      to: card.to,
      scenario: card.scenario,
      userIntent: card.userIntent,
      taskBrief: card.taskBrief,
      pinnedMessages: capPinnedMessages(card.pinnedMessages),
      rolesInGroup: card.rolesInGroup,
      previousAgent: card.previousAgent,
      relevantArtifacts: card.relevantArtifacts,
      contextAudit: card.contextAudit,
      fullHistoryRef: card.fullHistoryRef,
    },
  };
  const prompt = JSON.stringify(payload);

  if (prompt.length > MAX_SYSTEM_PROMPT_CHARS) {
    throw new Error('handoff system prompt exceeds 8k token guardrail');
  }

  return prompt;
}

async function tryGenerate(
  input: HandoffGeneratorInput,
  modelClient: HandoffModelClient,
  fallback: HandoffCard,
): Promise<{ ok: true; card: HandoffCard } | { ok: false }> {
  try {
    const raw = await modelClient.generate(input);
    const card = validateHandoffCard({
      ...fallback,
      ...(typeof raw === 'object' && raw !== null ? raw : {}),
      id: fallback.id,
      from: 'orchestrator',
      to: input.role,
      scenario: 'dispatch',
      generatedBy: 'orchestrator',
      pinnedMessages: capPinnedMessages(
        getPinnedMessages(raw) ?? fallback.pinnedMessages,
      ),
      relevantArtifacts: getRelevantArtifacts(raw) ?? fallback.relevantArtifacts,
      contextAudit: fallback.contextAudit,
      fullHistoryRef: `chat:${input.state.chatId}`,
      createdAt: new Date(),
    });
    return { ok: true, card };
  } catch {
    return { ok: false };
  }
}

function validateHandoffCard(card: HandoffCard): HandoffCard {
  return HandoffCardSchema.parse(card);
}

function toPromptPayload(input: HandoffGeneratorInput) {
  return {
    userMessage: input.state.userMessage,
    intake: input.state.intake,
    task: input.task,
    recipientRole: input.role,
    pinnedMessages: capPinnedMessages(input.pinnedMessages ?? []),
    relevantArtifacts: input.relevantArtifacts ?? [],
    contextAudit: input.contextAudit,
    recentHandoffCards: summarizePreviousCards(input.previousCards ?? []),
    fullHistoryRef: `chat:${input.state.chatId}`,
  };
}

function summarizePreviousCards(cards: HandoffCard[]): HandoffCard[] {
  return cards.slice(-MAX_RECENT_CARDS).map((card) => ({
    ...card,
    pinnedMessages: capPinnedMessages(card.pinnedMessages),
    previousAgent: undefined,
    contextAudit: undefined,
  }));
}

function capPinnedMessages(messages: PinnedMessage[]): PinnedMessage[] {
  return messages.slice(0, MAX_PINNED_MESSAGES);
}

function oneSentence(text: string): string {
  return text.split(/\n+/)[0]?.trim().slice(0, 240) || text.slice(0, 240);
}

function getPinnedMessages(raw: unknown): PinnedMessage[] | undefined {
  if (typeof raw !== 'object' || raw === null || !('pinnedMessages' in raw)) {
    return undefined;
  }
  const value = (raw as { pinnedMessages?: unknown }).pinnedMessages;
  return Array.isArray(value) ? (value as PinnedMessage[]) : undefined;
}

function getRelevantArtifacts(raw: unknown): ArtifactRef[] | undefined {
  if (typeof raw !== 'object' || raw === null || !('relevantArtifacts' in raw)) {
    return undefined;
  }
  const value = (raw as { relevantArtifacts?: unknown }).relevantArtifacts;
  return Array.isArray(value) ? (value as ArtifactRef[]) : undefined;
}
