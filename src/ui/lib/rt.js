/* ============================================================================
   Roundtable — fixtures.js   (golden-path "waitlist landing page" scenario)
   Mock data only. Shapes mirror the §4 contracts so these map 1:1 to the
   React/TS components when Claude Code wires the live tRPC/SSE stream.
   Attached to window.RT.
   ============================================================================ */
/* Ported from prototype fixtures.js — golden-path mock data (ESM). */
  // ---- Agents (AgentIdentity) ---------------------------------------------
  // Per-agent `color` drives ALL ownership coloring. Two implementers carry
  // DIFFERENT colors to show per-agent (not per-role) ownership — the demo's
  // 🟦 / 🟩 pair from Story A.
  const AGENTS = {
    orchestrator: {
      agentId: 'orchestrator', role: 'planner', displayName: 'PM',
      color: '#938b7c', avatar: '👑', pm: true,
    },
    atlas: {
      agentId: 'atlas', role: 'implementer', displayName: 'Atlas',
      color: '#5eb0ef', avatar: 'A',
    },
    beam: {
      agentId: 'beam', role: 'implementer', displayName: 'Beam',
      color: '#4cc38a', avatar: 'B',
    },
    vera: {
      agentId: 'vera', role: 'reviewer', displayName: 'Vera',
      color: '#e6a23c', avatar: 'V',
    },
    nova: {
      agentId: 'nova', role: 'architect', displayName: 'Nova',
      color: '#8b7cf6', avatar: 'N',
    },
  };

  // ---- Plan (live TodoList card) ------------------------------------------
  const PLAN = {
    id: 'plan-1',
    createdAt: '2026-05-31T13:20:00Z',
    tasks: [
      { id: 'T1', title: 'Scaffold landing page + email / company-size form',
        assignee: '@implementer', owner: 'atlas', deps: [], parallel: true,
        user_visible: true, status: 'pending' },
      { id: 'T2', title: 'POST /api/waitlist — validate + persist',
        assignee: '@implementer', owner: 'beam', deps: [], parallel: true,
        user_visible: true, status: 'pending' },
      { id: 'T3', title: 'Review both diffs before merge',
        assignee: '@reviewer', owner: 'vera', deps: ['T1', 'T2'], parallel: false,
        user_visible: true, status: 'pending' },
    ],
  };

  // status the plan moves through, keyed to playback time (ms from scene start)
  const PLAN_TIMELINE = [
    { at: 3200,  id: 'T1', status: 'running' },
    { at: 3200,  id: 'T2', status: 'running' },
    { at: 12000, id: 'T2', status: 'completed' },
    { at: 13500, id: 'T1', status: 'completed' },
    { at: 14200, id: 'T3', status: 'running' },
    { at: 22000, id: 'T3', status: 'completed' },
  ];

  // ---- Artifacts -----------------------------------------------------------
  const LANDING_CODE =
`export default function LandingPage() {
  return (
    <main className="wrap">
      <h1>Ship faster. Join the waitlist.</h1>
      <p>Be first to try Roundtable when we open the doors.</p>
      <form action="/api/waitlist" method="post">
        <input name="email" type="email" placeholder="you@company.com" required />
        <select name="companySize" required>
          <option value="">Company size…</option>
          <option>1–10</option><option>11–50</option>
          <option>51–200</option><option>200+</option>
        </select>
        <button type="submit">Request access</button>
      </form>
    </main>
  );
}`;

  const API_CODE =
`import { z } from 'zod';
import { db } from '@/server/db';

const Body = z.object({
  email: z.string().email(),
  companySize: z.enum(['1-10', '11-50', '51-200', '200+']),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success)
    return Response.json({ error: 'invalid' }, { status: 422 });

  await db.waitlist.create({ data: parsed.data });
  return Response.json({ ok: true });
}`;

  // diff lines carry an optional `author` (agentId) → multi-author tinting.
  const REVIEW_DIFF = {
    file: 'app/page.tsx',
    hunk: '@@ -3,6 +3,7 @@ export default function LandingPage() {',
    lines: [
      { t: 'ctx', text: '      <form action="/api/waitlist" method="post">' },
      { t: 'ctx', text: '        <input name="email" type="email"' },
      { t: 'del', text: '               placeholder="you@company.com" required />', author: 'atlas' },
      { t: 'add', text: '               placeholder="you@company.com" required',  author: 'atlas' },
      { t: 'add', text: '               aria-label="Work email" autoComplete="email" />', author: 'vera' },
      { t: 'ctx', text: '        <select name="companySize" required>' },
    ],
  };

  const PREVIEW_HTML =
`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;font-family:'IBM Plex Sans',system-ui,sans-serif;background:
    radial-gradient(120% 120% at 80% -10%,#eef3ff 0%,#f7f8fb 45%,#fbfbfd 100%);
    color:#1a2030;display:grid;place-items:center;min-height:100vh;padding:32px}
  .wrap{max-width:440px;width:100%;text-align:left}
  .kic{font:600 12px/1 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#5eb0ef;margin-bottom:18px}
  h1{font-size:34px;line-height:1.1;margin:0 0 12px;letter-spacing:-.02em}
  p{color:#5f6b80;margin:0 0 26px;font-size:16px;line-height:1.5}
  form{display:flex;flex-direction:column;gap:11px}
  input,select{font:inherit;padding:13px 14px;border:1px solid #dde3ee;border-radius:11px;background:#fff;color:#1a2030}
  input:focus,select:focus{outline:none;border-color:#5eb0ef;box-shadow:0 0 0 3px #5eb0ef33}
  button{font:600 15px/1 'IBM Plex Sans',sans-serif;padding:14px;border:0;border-radius:11px;
    background:#1a2030;color:#fff;cursor:pointer;margin-top:4px}
  button:hover{background:#2b3550}
  .tag{margin-top:18px;font-size:12.5px;color:#9aa5b8}
</style></head>
<body><main class="wrap">
  <div class="kic">Roundtable</div>
  <h1>Ship faster. Join the waitlist.</h1>
  <p>Be first to try Roundtable when we open the doors to non-coders building with agent teams.</p>
  <form onsubmit="event.preventDefault();this.innerHTML='<div style=&quot;padding:16px;color:#4cc38a;font-weight:600&quot;>✓ You\\'re on the list.</div>'">
    <input type="email" placeholder="you@company.com" required>
    <select required><option value="">Company size…</option><option>1–10</option><option>11–50</option><option>51–200</option><option>200+</option></select>
    <button type="submit">Request access</button>
  </form>
  <div class="tag">No spam. One launch email.</div>
</main></body></html>`;

  const ARTIFACTS = {
    landing: {
      id: 'art-landing', kind: 'file', title: 'app/page.tsx', ownerAgentId: 'atlas',
      version: 1, preview: LANDING_CODE, lang: 'tsx', source: 'generated', createdAt: '2026-05-31T13:20:09Z',
    },
    api: {
      id: 'art-api', kind: 'file', title: 'app/api/waitlist/route.ts', ownerAgentId: 'beam',
      version: 1, preview: API_CODE, lang: 'ts', source: 'generated', createdAt: '2026-05-31T13:20:08Z',
    },
    diff: {
      id: 'art-diff', kind: 'diff', title: 'app/page.tsx', ownerAgentId: 'vera',
      version: 2, diff: REVIEW_DIFF, source: 'generated', createdAt: '2026-05-31T13:20:19Z',
    },
    preview: {
      id: 'art-preview', kind: 'preview', title: 'Waitlist landing — live preview',
      ownerAgentId: 'atlas', version: 1, preview: PREVIEW_HTML, code: LANDING_CODE,
      source: 'generated', createdAt: '2026-05-31T13:20:21Z',
    },
    brief: {
      id: 'art-brief', kind: 'doc', title: 'brand-guidelines.pdf', ownerAgentId: 'user',
      version: 1, source: 'uploaded',
      preview: 'Brand: calm, document-like. Type: IBM Plex. Confident tone, no marketing fluff. Primary action color comes from the product palette.',
      createdAt: '2026-05-31T13:18:00Z',
    },
  };

  // ---- HandoffCard ---------------------------------------------------------
  const HANDOFF = {
    id: 'ho-1', from: 'orchestrator', to: '@implementer', scenario: 'dispatch',
    userIntent: 'Build a waitlist landing page that captures email + company size.',
    taskBrief: 'Scaffold the landing page (app/page.tsx): headline, sub, and a form ' +
      'posting email + companySize to /api/waitlist. Keep it server-component friendly.',
    pinnedMessages: [
      { id: 'p1', content: 'Deploy target: Vercel + Postgres.', pinnedBy: 'user' },
      { id: 'p2', content: 'Brand: calm, document-like. No marketing fluff.', pinnedBy: 'user' },
    ],
    rolesInGroup: [AGENTS.atlas, AGENTS.beam, AGENTS.vera],
    previousAgent: null,
    relevantArtifacts: [
      { id: 'art-api', kind: 'file', title: 'app/api/waitlist/route.ts' },
    ],
    fullHistoryRef: 'thread://main/turn-1',
    createdAt: '2026-05-31T13:20:03Z', generatedBy: 'orchestrator',
  };

  // ---- Workbench (a fixed team) running multiple tasks --------------------
  // A round table === a workbench: a persistent set of members that runs many tasks.
  const WORKBENCH = { id: 'wb-product', name: 'Product Squad', members: ['orchestrator', 'atlas', 'beam', 'vera', 'nova'] };
  const WORKBENCHES = [
    { id: 'wb-product', name: 'Product Squad' },
    { id: 'wb-growth', name: 'Growth Pod' },
    { id: 'wb-infra', name: 'Platform / Infra' },
  ];
  const TASKS = [
    { id: 't1', title: 'Waitlist landing page', meta: '3 members · running', status: 'live', active: true },
    { id: 't2', title: 'Auth flow security audit', meta: 'queued', status: 'queued' },
    { id: 't3', title: 'Stripe checkout integration', meta: 'shipped · 2h ago', status: 'done' },
    { id: 't4', title: 'Migrate to Postgres', meta: 'shipped · yesterday', status: 'done' },
  ];

  // ---- Workflow : the packaged, customizable process the workbench runs ----
  const WORKFLOW = {
    template: 'Full-stack Squad',
    stages: [
      { id: 'intake', name: 'Intake', icon: 'clip', desc: 'Capture the goal in plain language.', who: ['user'], fixed: true },
      { id: 'plan', name: 'Plan', icon: 'layers', desc: 'Facilitator breaks the goal into parallel tasks.', who: ['orchestrator'] },
      { id: 'build', name: 'Build', icon: 'code', desc: 'Implementers write the code concurrently.', who: ['atlas', 'beam'], parallel: true },
      { id: 'review', name: 'Review', icon: 'eye', desc: 'Reviewer checks quality & accessibility.', who: ['vera'], gate: true },
      { id: 'ship', name: 'Ship', icon: 'rocket', desc: 'Deploy to production.', who: [], gate: true },
    ],
  };

  // ---- Scripted thread / streaming timeline -------------------------------
  // Each "beat" is revealed at `at` ms. Agent beats carry an AgentEvent stream
  // the MessageGroup plays out (text streams char-by-char during `dur`).
  const SCRIPT = [
    { at: 0, kind: 'user', id: 'u1',
      text: 'Build me a waitlist landing page that captures email + company size.' },

    { at: 700, kind: 'agent', id: 'm-pm-1', agentId: 'orchestrator', dur: 1600,
      events: [
        { type: 'text_delta', delta: 'On it. Picking a team and splitting this into parallel work — you’ll see the plan below.' },
        { type: 'done' },
      ] },

    { at: 2400, kind: 'handoff', id: 'b-handoff', handoffId: 'ho-1' },
    { at: 2900, kind: 'plan', id: 'b-plan', planId: 'plan-1' },

    { at: 3600, kind: 'agent', id: 'm-atlas', agentId: 'atlas', dur: 8200,
      events: [
        { type: 'thinking_delta', delta: 'Server component, native form post to /api/waitlist, no client JS needed for submit.' },
        { type: 'tool_use', id: 'tu1', name: 'Claude Code', input: { cmd: 'write app/page.tsx' } },
        { type: 'text_delta', delta: 'Scaffolded the landing page — headline, sub, and a form wired to the API.' },
        { type: 'artifact', artifactId: 'landing' },
        { type: 'done', usage: { inputTokens: 1840, outputTokens: 612 } },
      ] },

    { at: 4100, kind: 'agent', id: 'm-beam', agentId: 'beam', dur: 7000,
      events: [
        { type: 'thinking_delta', delta: 'Zod-validate email + companySize enum, persist via db.waitlist, return 422 on bad input.' },
        { type: 'tool_use', id: 'tu2', name: 'Claude Code', input: { cmd: 'write route.ts' } },
        { type: 'text_delta', delta: 'Endpoint done — validates body and persists to the waitlist table.' },
        { type: 'artifact', artifactId: 'api' },
        { type: 'done', usage: { inputTokens: 1520, outputTokens: 488 } },
      ] },

    { at: 13800, kind: 'breakout', id: 'b-breakout',
      a: 'beam', b: 'vera', turns: 2,
      summary: '@implementer and @reviewer aligned on validation',
      transcript: [
        { agentId: 'vera', text: 'The email input has no aria-label — screen readers will just read “edit text”.' },
        { agentId: 'beam', text: 'Good catch. Atlas owns the markup — flagging it on the page diff for them.' },
      ] },

    { at: 14600, kind: 'agent', id: 'm-vera', agentId: 'vera', dur: 6400,
      events: [
        { type: 'thinking_delta', delta: 'Functionally correct. One a11y nit on the email field.' },
        { type: 'text_delta', delta: 'Looks good to merge — one nit: the email field needs an accessible label. Suggested fix attached.' },
        { type: 'artifact', artifactId: 'diff' },
        { type: 'done', usage: { inputTokens: 2010, outputTokens: 240 } },
      ] },

    { at: 22400, kind: 'aggregate', id: 'b-agg', agentId: 'orchestrator',
      text: 'Three artifacts shipped and reviewed. Reviewer left one accessibility nit — one click to apply.',
      actions: [
        { id: 'preview', label: 'Preview live page', kind: 'primary', icon: 'play' },
        { id: 'fix', label: 'Apply review fix', kind: 'default', icon: 'wrench', badge: 1 },
        { id: 'deploy', label: 'Deploy to Vercel', kind: 'default', icon: 'rocket' },
      ] },
  ];

  const SCENE_DURATION = 24000;

  // A mid-run decision: an agent raises a hand and needs the user's call.
  const DECISION = {
    at: 9000, until: 13200, agentId: 'beam',
    question: 'Company size — fixed options or free text?',
    detail: 'Affects the form field and the DB column.',
    options: [
      { id: 'enum', label: 'Fixed options', hint: 'recommended' },
      { id: 'free', label: 'Free text' },
    ],
  };

export const RT = {
    AGENTS, PLAN, PLAN_TIMELINE, ARTIFACTS, HANDOFF,
    WORKBENCH, WORKBENCHES, TASKS, WORKFLOW, SCRIPT, SCENE_DURATION, DECISION,
    ROLE_COLORS: {
      architect: '#9579b0', planner: '#5f86b8', implementer: '#5a9e8c',
      reviewer: '#bd9a55', fixer: '#c47766',
    },
    agent: (id) => AGENTS[id],
};
