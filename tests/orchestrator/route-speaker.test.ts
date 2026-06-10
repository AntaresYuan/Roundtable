import { describe, expect, it } from 'vitest';
import { ChatIdSchema } from '../../src/contracts/index.js';
import {
  buildDirectPlan,
  defaultRoomRoster,
  parseExplicitMentions,
  resolveSpeakerRouting,
} from '../../src/orchestrator/nodes/route-speaker.js';

const roster = defaultRoomRoster();
const chatId = ChatIdSchema.parse('chat-1');

describe('defaultRoomRoster', () => {
  it('exposes the five SDLC roles', () => {
    expect(roster.map((a) => a.role).sort()).toEqual([
      'architect',
      'fixer',
      'implementer',
      'planner',
      'reviewer',
    ]);
  });
});

describe('parseExplicitMentions', () => {
  it('matches a single @role', () => {
    expect(parseExplicitMentions('@implementer build the page', roster).map((a) => a.role)).toEqual([
      'implementer',
    ]);
  });

  it('matches multiple distinct @roles, de-duped, in order', () => {
    const got = parseExplicitMentions('@reviewer and @implementer, also @reviewer', roster);
    expect(got.map((a) => a.role)).toEqual(['reviewer', 'implementer']);
  });

  it('ignores unknown @handles and bare text', () => {
    expect(parseExplicitMentions('@nobody just do it', roster)).toEqual([]);
    expect(parseExplicitMentions('build the page', roster)).toEqual([]);
  });
});

describe('resolveSpeakerRouting', () => {
  it('routes an explicit @mention directly, bypassing the selector', async () => {
    const routing = await resolveSpeakerRouting('@reviewer check this', roster, { chatId }, false);
    expect(routing.kind).toBe('direct');
    if (routing.kind === 'direct') {
      expect(routing.speakers.map((a) => a.role)).toEqual(['reviewer']);
      expect(routing.reason).toBe('explicit @mention');
    }
  });

  it('falls back to PM planning for un-mentioned messages when selector is off', async () => {
    const routing = await resolveSpeakerRouting('build a waitlist page', roster, { chatId }, false);
    expect(routing.kind).toBe('plan');
  });

  it('consults the selector for un-mentioned single-agent messages', async () => {
    // "review" keyword matches the reviewer role; heuristic selector picks it.
    const routing = await resolveSpeakerRouting('please review my diff', roster, { chatId }, true);
    expect(routing.kind).toBe('direct');
    if (routing.kind === 'direct') expect(routing.speakers[0]!.role).toBe('reviewer');
  });

  it('falls back to PM planning when nothing matches the selector', async () => {
    const routing = await resolveSpeakerRouting('xyzzy zork frobnicate', roster, { chatId }, true);
    expect(routing.kind).toBe('plan');
  });
});

describe('buildDirectPlan', () => {
  it('builds a single user-visible task assigned to the chosen role', () => {
    const plan = buildDirectPlan(parseExplicitMentions('@implementer build it', roster), 'build it');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]!.assignee).toBe('@implementer');
    expect(plan.tasks[0]!.user_visible).toBe(true);
    expect(plan.tasks[0]!.parallel).toBeUndefined();
  });

  it('builds parallel tasks for multiple speakers and strips @handles from the title', () => {
    const speakers = parseExplicitMentions('@implementer @reviewer ship the login page', roster);
    const plan = buildDirectPlan(speakers, '@implementer @reviewer ship the login page');
    expect(plan.tasks.map((t) => t.assignee)).toEqual(['@implementer', '@reviewer']);
    expect(plan.tasks.every((t) => t.parallel === true)).toBe(true);
    expect(plan.tasks[0]!.title).toBe('ship the login page');
  });
});
