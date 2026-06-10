import { randomUUID } from 'node:crypto';
import {
  AgentDescriptionSchema,
  type AgentDescription,
  type Plan,
  type PlanTask,
} from '../../contracts/index.js';
import type { ClarifyQuestion } from '../state.js';
import { runSelector, type RunSelectorOpts } from './selector.js';

/**
 * Live @mention routing (spec 050 §(a)). This is the thin layer that finally
 * WIRES the existing speaker selector into the turn flow:
 *   - explicit `@agent`  → direct delivery (bypass the selector)
 *   - multiple `@agents` → parallel direct delivery
 *   - no `@`             → `runSelector` picks the next speaker
 *   - ≥4-agent low-confidence → clarify ("@A or @B?")
 *   - nothing fits       → `kind:'plan'`, caller falls back to PM planning
 *
 * It only composes existing pieces (`runSelector`, the `Plan` contract). It does
 * not change the selector's decision logic or the dispatch pipeline.
 */

/** SDLC roles that make up the default room roster (spec 010 role model). */
const ROLE_ROSTER: ReadonlyArray<{ role: string; description: string; capabilities: string[] }> = [
  { role: 'architect', description: 'designs system structure and technical approach', capabilities: ['architecture', 'design', 'schema', 'structure'] },
  { role: 'planner', description: 'breaks work into tasks and acceptance criteria', capabilities: ['plan', 'requirements', 'breakdown', 'scope'] },
  { role: 'implementer', description: 'writes and edits code and files', capabilities: ['code', 'implement', 'build', 'feature', 'ui', 'api', 'page'] },
  { role: 'reviewer', description: 'reviews diffs and surfaces correctness and UX concerns', capabilities: ['review', 'check', 'audit', 'correctness', 'accessibility'] },
  { role: 'fixer', description: 'applies fixes and resolves review comments', capabilities: ['fix', 'patch', 'bug', 'resolve'] },
];

export function defaultRoomRoster(): AgentDescription[] {
  return ROLE_ROSTER.map((r) =>
    AgentDescriptionSchema.parse({
      id: r.role,
      displayName: r.role,
      role: r.role,
      description: r.description,
      capabilities: r.capabilities,
    }),
  );
}

/** Explicit `@agent` mentions resolved against the roster (spec 050 §(a) row 1/3). */
export function parseExplicitMentions(
  message: string,
  roster: AgentDescription[],
): AgentDescription[] {
  const out: AgentDescription[] = [];
  const seen = new Set<string>();
  const re = /@([a-z][a-z0-9_-]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(message)) !== null) {
    const tag = match[1]!.toLowerCase();
    const agent = roster.find(
      (a) =>
        a.id.toLowerCase() === tag ||
        a.role.toLowerCase() === tag ||
        a.displayName.toLowerCase() === tag,
    );
    if (agent && !seen.has(agent.id)) {
      seen.add(agent.id);
      out.push(agent);
    }
  }
  return out;
}

export type SpeakerRouting =
  | { kind: 'direct'; speakers: AgentDescription[]; reason: string }
  | { kind: 'plan' }
  | { kind: 'clarify'; question: ClarifyQuestion; reason: string };

export async function resolveSpeakerRouting(
  message: string,
  roster: AgentDescription[],
  opts: RunSelectorOpts,
  /**
   * Consult the selector for un-mentioned messages. Callers gate this on intake
   * complexity: a `multi_agent` request goes to PM planning, not a single
   * speaker (brainstorm Theme 2 — simple → direct, complex → plan). Explicit
   * `@mentions` always route directly regardless of this flag.
   */
  consultSelector = true,
): Promise<SpeakerRouting> {
  const mentions = parseExplicitMentions(message, roster);
  if (mentions.length > 0) {
    return { kind: 'direct', speakers: mentions, reason: 'explicit @mention' };
  }
  if (!consultSelector) return { kind: 'plan' };

  const { decision, clarifyQuestion, fallbackTriggered } = await runSelector(
    { userMessage: message, agents: roster },
    opts,
  );
  if (fallbackTriggered && clarifyQuestion) {
    return { kind: 'clarify', question: clarifyQuestion, reason: decision.reasoning };
  }
  if (decision.chosenAgentId) {
    const agent = roster.find((a) => a.id === decision.chosenAgentId);
    if (agent) return { kind: 'direct', speakers: [agent], reason: decision.reasoning };
  }
  return { kind: 'plan' };
}

/** A direct plan: one user-visible task per chosen speaker (parallel when >1). */
export function buildDirectPlan(speakers: AgentDescription[], message: string): Plan {
  const parallel = speakers.length > 1;
  const tasks: PlanTask[] = speakers.map((agent, i) => ({
    id: `T${i + 1}`,
    title: directTaskTitle(message),
    assignee: `@${agent.role}`,
    deps: [],
    ...(parallel ? { parallel: true, parallelGroup: 'mention' } : {}),
    user_visible: true,
    status: 'pending' as const,
  }));
  return { id: randomUUID(), createdAt: new Date(), tasks };
}

function directTaskTitle(message: string): string {
  const brief = message.replace(/@[a-z][a-z0-9_-]*/gi, '').trim() || message.trim();
  return brief.length <= 80 ? brief : `${brief.slice(0, 77)}…`;
}
