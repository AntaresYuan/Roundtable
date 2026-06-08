'use client';
/* ============================================================================
   Roundtable — app.jsx
   Top-level: timeline driver, drawer, Table scene + Gallery, controls, Tweaks.
   ============================================================================ */

import React from 'react';
import { RT } from '../lib/rt';
import { Avatar, RoleTag, Icon, Spinner, Chip, tint, alpha } from './primitives';
import { ArtifactRenderer, CodeBlock, VChip, TodoListCard, HandoffCard, BreakoutChip, iconBtn, normalizeArtifactForDisplay } from './cards';
import { MessageGroup, Composer, ConversationRail, LogoMark } from './chat';
import { RoundtableScene, WhiteboardZoom, sceneAt, meetingNotes } from './roundtable';
import { WorkflowView, WorkflowStrip } from './workflow';
import { Modal, NewTaskModal, NewWorkbenchModal, AddAgentModal, EditHandoffModal } from './modals';
import { DependencyGraphSidebar } from './dep-graph';
import { MemoryPanel } from './memory-panel';
import { useSession } from 'next-auth/react';
import { trpc } from '@/ui/lib/trpc';

const { useState, useEffect, useMemo, useRef } = React;

// Minimal tweak-state hook — replaces the prototype's tweaks-panel dev tool.
function useTweaks(defaults) {
  const [t, setT] = useState(defaults);
  const setTweak = (k, v) => setT((prev) => ({ ...prev, [k]: v }));
  return [t, setTweak];
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/* ---- palette remap -------------------------------------------------------- */
const PALETTES = {
  soft:    { architect: '#9579b0', planner: '#5f86b8', implementer: '#5a9e8c', reviewer: '#bd9a55', fixer: '#c47766' },
  vivid:   { architect: '#6366f1', planner: '#0ea5e9', implementer: '#10b981', reviewer: '#f59e0b', fixer: '#ef4444' },
  earthen: { architect: '#b16286', planner: '#458588', implementer: '#98971a', reviewer: '#d79921', fixer: '#cc241d' },
};
function palettize(palette) {
  const p = PALETTES[palette] || PALETTES.soft;
  const base = RT.AGENTS;
  const map = { atlas: p.planner, beam: p.implementer, vera: p.reviewer, nova: p.architect };
  const out = {};
  for (const k in base) out[k] = { ...base[k], color: map[k] || base[k].color };
  return out;
}

/* ---- timeline hook -------------------------------------------------------- */
function useScene(autoplay, speed) {
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const raf = useRef(0), last = useRef(0);
  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const loop = (now) => {
      const dt = (now - last.current) * (speed || 1);
      last.current = now;
      setClock(c => {
        const n = c + dt;
        if (n >= RT.SCENE_DURATION) { setPlaying(false); return RT.SCENE_DURATION; }
        return n;
      });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed]);
  const replay = () => { setClock(0); setPlaying(true); };
  const toggle = () => {
    if (clock >= RT.SCENE_DURATION) replay();
    else setPlaying(p => !p);
  };
  return { clock, playing, replay, toggle, setClock, setPlaying };
}

/* ---- Drawer --------------------------------------------------------------- */
function Drawer({ art, agents, onClose }) {
  if (!art) return null;
  const displayArt = normalizeArtifactForDisplay(art);
  const owner = ownerForDrawer(displayArt, agents);
  const isPreview = displayArt.kind === 'preview';
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100,
      background: alpha('#000', 32), backdropFilter: 'blur(2px)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} className="rt-rise" style={{ width: 'min(620px, 92vw)',
        height: '100%', background: 'var(--surface)', borderLeft: '1px solid var(--border)',
        boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 18px',
          borderBottom: '1px solid var(--border)' }}>
          <Avatar agent={owner} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{displayArt.title}</div>
            <div style={{ marginTop: 2 }}><RoleTag agent={owner} showName /></div>
          </div>
          <VChip v={displayArt.version} />
          <button onClick={onClose} style={iconBtn}><Icon name="x" size={16} /></button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 18, background: 'var(--surface-2)' }}>
          {isPreview
            ? <div style={{ borderRadius: 'var(--r-card)', overflow: 'hidden', border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-card)' }}>
                <iframe title="preview" srcDoc={displayArt.preview} sandbox="allow-scripts"
                  style={{ width: '100%', height: 560, border: 'none', display: 'block', background: '#fff' }} />
              </div>
            : displayArt.kind === 'diff'
            ? <div style={{ borderRadius: 'var(--r-card)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                <ArtifactRenderer art={displayArt} agents={agents} /></div>
            : <div style={{ borderRadius: 'var(--r-card)', overflow: 'hidden', border: '1px solid var(--border)',
                background: 'var(--surface)' }}>
                <CodeBlock code={displayArt.code || displayArt.preview || displayArt.uri || ''} /></div>}
        </div>
      </div>
    </div>
  );
}

function ownerForDrawer(art, agents) {
  const ownerId = art.ownerAgentId;
  const direct = ownerId ? agents?.[ownerId] : null;
  if (direct) return direct;
  const byRole = ownerId
    ? Object.values(agents || {}).find((agent) => agent.role === ownerId)
    : null;
  if (byRole) return byRole;
  return {
    agentId: ownerId || 'agent',
    role: ownerId || 'agent',
    displayName: ownerId ? `@${ownerId}` : 'Agent',
    color: 'var(--text-muted)',
  };
}

/* ---- Aggregate quick actions --------------------------------------------- */
function Aggregate({ beat, agents, onAction }) {
  const pm = agents.orchestrator;
  return (
    <div className="rt-rise" style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
      <Avatar agent={pm} size={26} ring={false} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
          <Icon name="check" size={15} style={{ color: 'var(--ok)' }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>Round complete</span>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 12, lineHeight: 1.55 }}>{beat.text}</div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {beat.actions.map(a => (
            <button key={a.id} onClick={() => onAction(a.id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px',
              borderRadius: 'var(--r-sm)', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              border: a.kind === 'primary' ? 'none' : '1px solid var(--border)',
              background: a.kind === 'primary' ? 'var(--accent)' : 'var(--surface)',
              color: a.kind === 'primary' ? '#fff' : 'var(--text)', transition: 'all .15s ease' }}>
              <Icon name={a.icon} size={15} />{a.label}
              {a.badge && <span className="tnum" style={{ fontSize: 11, fontWeight: 700, minWidth: 16, height: 16,
                padding: '0 4px', borderRadius: 8, display: 'grid', placeItems: 'center',
                background: a.kind === 'primary' ? alpha('#fff', 25) : alpha('var(--warn)', 18),
                color: a.kind === 'primary' ? '#fff' : 'var(--warn)' }}>{a.badge}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---- Thread (Table view center) ------------------------------------------ */
function Thread({ agents, scene, onOpenArtifact, onAction }) {
  const ref = useRef(null);
  const revealed = RT.SCRIPT.filter(b => b.at <= scene.clock);
  const [handoff, setHandoff] = useState(RT.HANDOFF);
  const [syncHandoffs, setSyncHandoffs] = useState([]);
  const [editingHandoff, setEditingHandoff] = useState(null); // { ho, onSave } | null
  const noticesByArtifact = useMemo(() => {
    const m = new Map();
    (RT.DEP_CHANGED_NOTICES || []).forEach(n => m.set(n.downstream.artifactId, n));
    return m;
  }, []);
  const reviewsByArtifact = useMemo(() => {
    const m = new Map();
    (RT.REVIEW_COMMENTS || []).forEach(c => {
      if (!m.has(c.artifactId)) m.set(c.artifactId, []);
      m.get(c.artifactId).push(c);
    });
    return m;
  }, []);
  const applyReviewFix = (comment) => {
    const art = Object.values(RT.ARTIFACTS).find(a => a.id === comment.artifactId);
    const fixer = agents[comment.author] || agents.vera;
    const prefill = {
      ...handoff,
      id: `ho-fix-${comment.id}`,
      to: `@fixer`,
      scenario: 'agent_handoff',
      taskBrief:
        `Apply ${fixer?.displayName || comment.author}'s review note ` +
        `on ${art?.title || comment.artifactId}` +
        (comment.line !== undefined ? `:${comment.line}` : '') +
        `:\n\n${comment.body}\n\n` +
        `Edit the file in place — multi-author diff lines will tint by author.`,
    };
    setEditingHandoff({
      ho: prefill,
      onSave: (next) =>
        setSyncHandoffs((prev) => {
          const without = prev.filter((p) => p.id !== next.id);
          return [...without, next];
        }),
    });
  };
  const openEditDispatch = () =>
    setEditingHandoff({ ho: handoff, onSave: (next) => setHandoff(next) });
  const askSync = (notice) => {
    const owner = agents[notice.upstream.ownerAgentId];
    const prefill = {
      ...handoff,
      id: `ho-sync-${notice.upstream.artifactId}-${notice.upstream.toVersion}`,
      to: `@${owner?.role || notice.upstream.ownerAgentId}`,
      scenario: 'agent_handoff',
      taskBrief:
        `Sync ${notice.downstream.title || notice.downstream.artifactId} ` +
        `after ${notice.upstream.title || notice.upstream.artifactId} bumped ` +
        `v${notice.upstream.fromVersion}→v${notice.upstream.toVersion} ` +
        `(${notice.kind}). Repair the downstream call site.`,
    };
    setEditingHandoff({
      ho: prefill,
      onSave: (next) =>
        setSyncHandoffs((prev) => {
          const without = prev.filter((p) => p.id !== next.id);
          return [...without, next];
        }),
    });
  };
  const plan = useMemo(() => {
    const tasks = RT.PLAN.tasks.map(t => ({ ...t }));
    RT.PLAN_TIMELINE.forEach(u => { if (u.at <= scene.clock) { const tk = tasks.find(x => x.id === u.id); if (tk) tk.status = u.status; } });
    return { ...RT.PLAN, tasks };
  }, [scene.clock]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [revealed.length, scene.clock >= RT.SCENE_DURATION]);

  // follow the live stream to the bottom while playing
  useEffect(() => {
    if (!scene.playing) return;
    const iv = setInterval(() => {
      if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    }, 160);
    return () => clearInterval(iv);
  }, [scene.playing]);

  return (
    <div ref={ref} id="thread-scroll" style={{ flex: 1, overflowY: 'auto', padding: '26px 26px 8px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--thread-gap)' }}>
        {revealed.map(b => {
          const live = scene.playing && scene.clock < b.at + (b.dur || 1400) + 300;
          if (b.kind === 'user') return <UserMsg key={b.id} text={b.text} />;
          if (b.kind === 'agent') return <MessageGroup key={b.id} beat={b} agents={agents} playing={live} onOpenArtifact={onOpenArtifact} noticesByArtifact={noticesByArtifact} onAskSync={askSync} reviewsByArtifact={reviewsByArtifact} onApplyFix={applyReviewFix} />;
          if (b.kind === 'plan') return <TodoListCard key={b.id} plan={plan} agents={agents} />;
          if (b.kind === 'handoff') return <HandoffCard key={b.id} ho={handoff} agents={agents} onEdit={openEditDispatch} />;
          if (b.kind === 'breakout') return <div key={b.id} className="rt-rise"><BreakoutChip data={b} agents={agents} /></div>;
          if (b.kind === 'aggregate') return <Aggregate key={b.id} beat={b} agents={agents} onAction={onAction} />;
          return null;
        })}
        {syncHandoffs.map((syncHo) => (
          <HandoffCard
            key={syncHo.id}
            ho={syncHo}
            agents={agents}
            onEdit={() =>
              setEditingHandoff({
                ho: syncHo,
                onSave: (next) =>
                  setSyncHandoffs((prev) =>
                    prev.map((p) => (p.id === syncHo.id ? next : p)),
                  ),
              })
            }
          />
        ))}
        <div style={{ height: 8 }} />
      </div>
      {editingHandoff && (
        <EditHandoffModal
          ho={editingHandoff.ho}
          onClose={() => setEditingHandoff(null)}
          onSave={editingHandoff.onSave}
        />
      )}
    </div>
  );
}
function UserMsg({ text }) {
  return (
    <div className="rt-rise" style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
      <div style={{ maxWidth: '78%', padding: '11px 15px', borderRadius: '14px 14px 4px 14px',
        background: 'var(--accent)', color: '#fff', fontSize: 14, lineHeight: 1.5,
        boxShadow: 'var(--shadow-card)' }}>{text}</div>
      <Avatar agent={{ id: 'you-user', displayName: 'You', color: '#8076a0' }} size={30} />
    </div>
  );
}

function LocalLiveThread({ turns, agents, onApproveTurn }) {
  if (!turns || turns.length === 0) {
    return (
      <div style={{ minHeight: 220, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--text-faint)' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>No live turn yet</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>Send a message below to run the real PM model from local env.</div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {turns.map((turn, index) => (
          <LocalLiveTurn
            key={turn.id}
            turn={turn}
            agents={agents}
            onApproveTurn={onApproveTurn}
            showPreview={index === 0}
          />
        ))}
      </div>
    </div>
  );
}

function LocalLiveTurn({ turn, agents, onApproveTurn, showPreview }) {
  const completed = turn.result?.dispatchStatus === 'completed';
  const failed = turn.result?.dispatchStatus === 'failed';
  const artifacts = turn.result?.artifacts || [];
  const previewArtifact = artifacts.find((artifact) => artifact.kind === 'preview');
  return (
    <>
      <UserMsg text={turn.message} />
      <div className="rt-rise" style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <Avatar agent={agents.orchestrator} size={28} ring={false} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--pm)' }}>PM</span>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>local orchestrator</span>
            {turn.result && (
              <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-faint)' }}>
                {turn.result.provider} / {turn.result.model}
              </span>
            )}
          </div>
          {turn.status === 'pending' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13.5 }}>
              <Spinner size={13} color="var(--text-muted)" /> drafting the plan…
            </div>
          )}
          {turn.status === 'error' && (
            <div style={{ padding: '10px 12px', borderRadius: 'var(--r-sm)', background: alpha('var(--bad)', 12),
              color: 'var(--bad)', fontSize: 13, borderLeft: '2px solid var(--bad)' }}>
              {turn.error}
            </div>
          )}
          {turn.result && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.55 }}>
              <div style={{ marginBottom: 12 }}>{turn.result.pmMessage}</div>
              <LocalPlanCard
                plan={turn.result.plan}
                intake={turn.result.intake}
                agents={agents}
                approvalStatus={turn.result.approvalStatus || (turn.result.needsApproval ? 'pending' : 'approved')}
                approving={turn.approving}
                approvalError={turn.approvalError}
                onApprove={() => onApproveTurn && onApproveTurn(turn.id)}
              />
              {(completed || failed || artifacts.length > 0) && (
                <LocalResultCard
                  artifacts={artifacts}
                  dispatchStatus={turn.result.dispatchStatus}
                  dispatchAdapter={turn.result.dispatchAdapter}
                  dispatchStage={turn.result.dispatchStage}
                  workspacePath={turn.result.dispatchWorkspacePath || turn.result.workspacePath}
                  previewArtifact={showPreview ? previewArtifact : null}
                  agents={agents}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function LocalResultCard({ artifacts, dispatchStatus, dispatchAdapter, dispatchStage, workspacePath, previewArtifact, agents }) {
  const completed = dispatchStatus === 'completed';
  const codeCount = artifacts.filter((artifact) => artifact.kind === 'code').length;
  const reviewCount = artifacts.filter((artifact) => artifact.ownerAgentId === 'reviewer').length;
  const statusColor = completed ? 'var(--ok)' : dispatchStatus === 'failed' ? 'var(--bad)' : 'var(--run)';
  return (
    <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 'var(--r-card)',
      background: 'var(--surface)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
        borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <Icon name={completed ? 'check' : 'code'} size={15} style={{ color: statusColor }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 750, fontSize: 14, color: 'var(--text)' }}>
            {completed ? 'Result ready' : 'Result in progress'}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            {artifacts.length} artifacts · {codeCount} code · {reviewCount} review · adapter={dispatchAdapter || 'local-dispatch'} · next={dispatchStage || 'done'}
          </div>
        </div>
        <span style={{ fontSize: 11.5, color: statusColor, padding: '3px 8px', borderRadius: 999,
          background: alpha(statusColor, 14), fontWeight: 750 }}>
          {dispatchStatus || 'not_started'}
        </span>
      </div>
      {previewArtifact && (
        <div style={{ background: 'var(--surface-3)', padding: 12 }}>
          <div style={{ borderRadius: 'var(--r-sm)', overflow: 'hidden', border: '1px solid var(--border)',
            background: '#fff', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
              background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              {['#e5687a', '#e6a23c', '#4cc38a'].map((color) => (
                <span key={color} style={{ width: 9, height: 9, borderRadius: '50%', background: color, opacity: .8 }} />
              ))}
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>
                {previewArtifact.title}
              </span>
            </div>
            <iframe title={previewArtifact.title} srcDoc={previewArtifact.preview} sandbox="allow-scripts allow-forms allow-modals"
              style={{ width: '100%', height: 360, border: 'none', display: 'block', background: '#fff' }} />
          </div>
        </div>
      )}
      <div style={{ padding: '11px 14px', display: 'grid', gap: 8 }}>
        {artifacts.slice(0, 8).map((artifact) => {
          const owner = agentForArtifact(artifact, agents);
          return (
            <div key={`${artifact.id}-${artifact.version}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto',
              gap: 9, alignItems: 'center', padding: '8px 10px', borderRadius: 'var(--r-sm)',
              background: tint(owner.color, 7), border: `1px solid ${alpha(owner.color, 22)}` }}>
              <Icon name={artifact.kind === 'preview' ? 'eye' : artifact.kind === 'markdown' ? 'clip' : 'code'} size={14}
                style={{ color: owner.color }} />
              <span className="mono" style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artifact.title}</span>
              <span style={{ fontSize: 11, color: owner.color, fontWeight: 700 }}>@{owner.role || artifact.ownerAgentId}</span>
            </div>
          );
        })}
        {workspacePath && (
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>workspace: {workspacePath}</div>
        )}
      </div>
    </div>
  );
}

function LocalPlanCard({ plan, intake, agents, approvalStatus, approving, approvalError, onApprove }) {
  const ownerFor = (assignee) => {
    const role = assignee.replace(/^@/, '');
    return Object.values(agents).find((a) => a.role === role && !a.pm) || agents.orchestrator;
  };
  const approved = approvalStatus === 'approved';
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)', background: 'var(--surface)',
      boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <Icon name="layers" size={15} style={{ color: 'var(--accent)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Plan drafted</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            intent={intake.intentType} · risk={intake.risk} · clarity={intake.clarity}
          </div>
        </div>
        <span style={{ fontSize: 11.5, color: approved ? 'var(--ok)' : 'var(--warn)', padding: '3px 8px', borderRadius: 999,
          background: alpha(approved ? 'var(--ok)' : 'var(--warn)', 14), fontWeight: 700 }}>
          {approved ? 'approved' : 'awaiting approval'}
        </span>
        {!approved && (
          <button onClick={onApprove} disabled={approving} title="Approve this plan and let the run continue"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '7px 11px', borderRadius: 'var(--r-sm)', border: 'none',
              cursor: approving ? 'default' : 'pointer', background: approving ? 'var(--surface-3)' : 'var(--accent)',
              color: approving ? 'var(--text-faint)' : '#fff', font: 'inherit', fontSize: 12.5,
              fontWeight: 700, minHeight: 30, flexShrink: 0 }}>
            {approving ? <Spinner size={13} color="var(--text-faint)" /> : <Icon name="check" size={13} />}
            Approve
          </button>
        )}
      </div>
      {approvalError && (
        <div style={{ padding: '8px 14px', background: alpha('var(--bad)', 10), color: 'var(--bad)', fontSize: 12.5,
          borderBottom: '1px solid var(--border)' }}>
          {approvalError}
        </div>
      )}
      <div style={{ padding: '10px 14px 13px' }}>
        {plan.tasks.map((task) => {
          const owner = ownerFor(task.assignee);
          return (
            <div key={task.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 0',
              borderBottom: task.id === plan.tasks[plan.tasks.length - 1].id ? 'none' : '1px solid var(--border)' }}>
              <Avatar agent={owner} size={24} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{task.id}</span>
                  <span style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 600 }}>{task.title}</span>
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
                  {task.assignee}{task.parallel ? ' · parallel' : ''}{task.deps.length ? ` · waits on ${task.deps.join(', ')}` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- transport ------------------------------------------------------------ */
function Transport({ scene }) {
  const pct = Math.min(100, (scene.clock / RT.SCENE_DURATION) * 100);
  const done = scene.clock >= RT.SCENE_DURATION;
  const seek = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    scene.setClock(ratio * RT.SCENE_DURATION);
    scene.setPlaying(false);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button onClick={scene.toggle} title={scene.playing ? 'Pause' : done ? 'Replay' : 'Play'} style={{
        display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
        border: 'none', background: 'var(--accent)', color: '#fff' }}>
        <Icon name={scene.playing ? 'pause' : done ? 'replay' : 'play'} size={15} />
      </button>
      <div onClick={seek} title="Scrub" style={{ width: 150, padding: '8px 0', cursor: 'pointer' }}>
        <div style={{ height: 4, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden' }}>
          <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)', transition: 'width .1s linear' }} />
        </div>
      </div>
      <span className="mono tnum" style={{ fontSize: 11, color: 'var(--text-faint)', minWidth: 30 }}>
        {(scene.clock / 1000).toFixed(0)}s</span>
    </div>
  );
}

/* ---- ThreadHeader --------------------------------------------------------- */
function ThreadHeader({ agents, scene }) {
  const parts = ['atlas', 'beam', 'vera'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 26px',
      borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis' }}>Waitlist landing page</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
            flexShrink: 0,
            color: 'var(--run)', padding: '2px 8px', borderRadius: 'var(--r-chip)', background: alpha('var(--run)', 12) }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--run)' }} /> the main table
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
          <Avatar agent={agents.orchestrator} size={18} ring={false} />
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>facilitated by PM ·</span>
          <div style={{ display: 'flex' }}>
            {parts.map((p, i) => <span key={p} style={{ marginLeft: i ? -6 : 0, zIndex: 3 - i }}>
              <Avatar agent={agents[p]} size={20} /></span>)}
          </div>
        </div>
      </div>
      <Transport scene={scene} />
    </div>
  );
}

/* ---- Gallery -------------------------------------------------------------- */
function planVariant(which) {
  const t = RT.PLAN.tasks.map(x => ({ ...x }));
  if (which === 'pending') { /* all pending */ }
  if (which === 'mixed') { t[0].status = 'completed'; t[1].status = 'running'; }
  if (which === 'done') t.forEach(x => x.status = 'completed');
  if (which === 'failed') { t[0].status = 'completed'; t[1].status = 'failed'; t[2].status = 'pending'; }
  return { ...RT.PLAN, tasks: t };
}
function GalleryCard({ title, note, children, wide }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{title}</h3>
        {note && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{note}</span>}
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)',
        padding: 18, boxShadow: 'var(--shadow-card)' }}>{children}</div>
    </div>
  );
}
function Gallery({ agents, onOpenArtifact }) {
  const [pv, setPv] = useState('mixed');
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 60px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, letterSpacing: '-.01em' }}>Component gallery</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, maxWidth: 620 }}>
            The four Batch-1 components in isolation, with their states. Each maps 1:1 to the §4 prop
            contracts — colors are driven entirely by each agent’s <code className="mono">color</code> prop.
          </p>
        </div>

        {/* legend */}
        <GalleryCard title="Per-agent color ownership" note="the signature look" wide>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {Object.values(agents).map(a => (
              <div key={a.agentId} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <Avatar agent={a} size={30} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{a.displayName} {a.pm && '— muted'}</div>
                  <RoleTag agent={a} />
                </div>
              </div>
            ))}
          </div>
        </GalleryCard>

        <div style={{ height: 28 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 28 }}>
          <GalleryCard title="Live TodoList card" note="#12">
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {['pending', 'mixed', 'done', 'failed'].map(k => (
                <Chip key={k} active={pv === k} onClick={() => setPv(k)} color="var(--accent)">{k}</Chip>
              ))}
            </div>
            <TodoListCard plan={planVariant(pv)} agents={agents} onRetry={() => {}} />
          </GalleryCard>

          <GalleryCard title="HandoffCard" note="#13 · click to expand">
            <HandoffCard ho={RT.HANDOFF} agents={agents} />
          </GalleryCard>

          <GalleryCard title="Artifact — file" note="#3">
            <ArtifactRenderer art={RT.ARTIFACTS.landing} agents={agents} onOpen={onOpenArtifact} />
          </GalleryCard>

          <GalleryCard title="Artifact — diff (multi-author)" note="#3">
            <ArtifactRenderer art={RT.ARTIFACTS.diff} agents={agents} onOpen={onOpenArtifact} />
          </GalleryCard>

          <GalleryCard title="Artifact — preview" note="#3" wide>
            <ArtifactRenderer art={RT.ARTIFACTS.preview} agents={agents} onOpen={onOpenArtifact} />
          </GalleryCard>

          <GalleryCard title="Breakout chip" note="a door, not a toggle — click it" wide>
            <BreakoutChip data={RT.SCRIPT.find(b => b.kind === 'breakout')} agents={agents} />
          </GalleryCard>
        </div>
      </div>
    </div>
  );
}

/* ---- top-bar segmented --------------------------------------------------- */
function MiniSeg({ value, options, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 'var(--r-sm)', background: 'var(--surface-2)',
      border: '1px solid var(--border)' }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} title={o.label} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'calc(var(--r-sm) - 2px)',
          border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 500,
          background: value === o.v ? 'var(--surface)' : 'transparent',
          color: value === o.v ? 'var(--text)' : 'var(--text-muted)',
          boxShadow: value === o.v ? 'var(--shadow-card)' : 'none', transition: 'all .15s ease' }}>
          {o.icon && <Icon name={o.icon} size={14} />}{o.label}
        </button>
      ))}
    </div>
  );
}

/* ---- TopBar --------------------------------------------------------------- */
function TopBar({ t, setTweak, view, setView }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', height: 54,
      borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
      <MiniSeg value={view} onChange={setView} options={[
        { v: 'roundtable', label: 'Roundtable', icon: 'layers' },
        { v: 'workflow', label: 'Workflow', icon: 'sparkle' }]} />
      <div style={{ flex: 1 }} />
      <button onClick={() => setTweak('theme', t.theme === 'light' ? 'dark' : 'light')} title="Toggle theme"
        style={{ ...iconBtn, background: 'var(--surface-2)' }}>
        <Icon name={t.theme === 'light' ? 'moon' : 'sun'} size={16} />
      </button>
    </div>
  );
}

/* ---- Transcript sheet (clean, full scroll, no jank) ---------------------- */
function TranscriptSheet({ scene, agents, onOpenArtifact }) {
  const ref = useRef(null);
  const revealed = RT.SCRIPT.filter((b) => b.at <= scene.clock);
  useEffect(() => {
    if (scene.playing && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [revealed.length, scene.playing, scene.clock >= RT.SCENE_DURATION]);
  const line = (b) => {
    if (b.kind === 'user') return (
      <div key={b.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: '12px 12px 3px 12px', background: 'var(--accent)',
          color: '#fff', fontSize: 13, lineHeight: 1.45 }}>{b.text}</div>
      </div>
    );
    if (b.kind === 'agent') {
      const a = agents[b.agentId];
      const text = b.events.filter((e) => e.type === 'text_delta').map((e) => e.delta).join('');
      const art = b.events.find((e) => e.type === 'artifact');
      return (
        <div key={b.id} style={{ display: 'flex', gap: 10 }}>
          {a.pm ? <div style={{ width: 24, textAlign: 'center', fontSize: 13, opacity: .7 }}>•</div> : <Avatar agent={a} size={24} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: a.pm ? 'var(--pm)' : a.color }}>{a.displayName}</span>
              {!a.pm && <RoleTag agent={a} />}
            </div>
            <div style={{ fontSize: 13, color: a.pm ? 'var(--text-muted)' : 'var(--text)', lineHeight: 1.5, marginTop: 2 }}>{text}</div>
            {art && RT.ARTIFACTS[art.artifactId] && (
              <button onClick={() => onOpenArtifact(RT.ARTIFACTS[art.artifactId])} style={{ marginTop: 6, display: 'inline-flex',
                alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
                background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', fontSize: 11.5, cursor: 'pointer' }}>
                <Icon name="clip" size={12} /><span className="mono">{RT.ARTIFACTS[art.artifactId].title.split('/').pop()}</span>
              </button>
            )}
          </div>
        </div>
      );
    }
    const meta = { plan: ['layers', 'Plan posted — 3 tasks on the whiteboard'], handoff: ['door', 'Hand-off dispatched → @implementer'],
      breakout: ['door', `Breakout — ${b.a && agents[b.a]?.displayName} & ${b.b && agents[b.b]?.displayName}, ${b.turns} turns`],
      aggregate: ['check', 'Round complete — 3 artifacts shipped'] }[b.kind];
    if (!meta) return null;
    return (
      <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '2px 0', color: 'var(--text-faint)' }}>
        <Icon name={meta[0]} size={13} /><span style={{ fontSize: 12 }}>{meta[1]}</span>
      </div>
    );
  };
  return (
    <div ref={ref} style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {revealed.map(line)}
      </div>
    </div>
  );
}

/* ---- Now-dock (roundtable view) ------------------------------------------ */
// AI-ish workflow fit: a local heuristic (main has no backend ai.recommendWorkflow).
// Returns a better-fit builtin workflow for the active task, or null.
function recommendWorkflow(task, workflows, currentId) {
  const t = (task || '').toLowerCase();
  if (t.length < 4) return null;
  let pick = 'wf-fullstack';
  let reason = 'A full build → review → ship loop fits a feature like this.';
  if (/research|brief|spec|investigat|explore|compare|analy|gather|source|study|audit/.test(t)) {
    pick = 'wf-research'; reason = 'This reads like research — gather → synthesize → brief fits better.';
  } else if (/landing|marketing|convert|sign\s?up|wait\s?list|campaign|\bseo\b|hero|pricing page/.test(t)) {
    pick = 'wf-growth'; reason = 'This is a marketing page — brief → build → QA → launch fits better.';
  }
  const wf = (workflows || []).find((w) => w.id === pick);
  if (!wf || pick === currentId) return null;
  return { id: wf.id, name: wf.name, reason };
}

function Dock({ st, agents, scene, onAction, onOpenChat, onOpenWorkflow, onSend, liveStatus, rec, onUseWorkflow, onDismissRec }) {
  let dotColor = 'var(--text-faint)', body;
  if (st.decision) {
    const ag = agents[st.decision.agentId];
    dotColor = ag.color;
    body = (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
          <span style={{ fontSize: 15 }}>✋</span>
          <b style={{ color: ag.color }}>{ag.displayName}</b> needs your call:&nbsp;
          <span>{st.decision.question}</span>
        </span>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {st.decision.options.map((o, i) => (
            <button key={o.id} onClick={() => onAction('decide:' + o.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 'var(--r-sm)', font: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
              border: i === 0 ? 'none' : '1px solid var(--border)', background: i === 0 ? 'var(--accent)' : 'var(--surface)',
              color: i === 0 ? '#fff' : 'var(--text)' }}>
              {o.label}{o.hint && <span style={{ fontSize: 10, opacity: .8, fontWeight: 500 }}>{o.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  } else if (st.aggregate) {
    dotColor = 'var(--ok)';
    body = (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5 }}><b>Round complete</b> <span style={{ color: 'var(--text-faint)' }}>· 3 shipped · 1 nit</span></span>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {st.aggregate.actions.map((a) => (
            <button key={a.id} onClick={() => onAction(a.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 11px', borderRadius: 'var(--r-sm)', font: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
              border: a.kind === 'primary' ? 'none' : '1px solid var(--border)',
              background: a.kind === 'primary' ? 'var(--accent)' : 'var(--surface)', color: a.kind === 'primary' ? '#fff' : 'var(--text)' }}>
              <Icon name={a.icon} size={13} />{a.label}
              {a.badge && <span className="tnum" style={{ fontSize: 10, fontWeight: 700, minWidth: 14, height: 14, padding: '0 3px',
                borderRadius: 7, display: 'grid', placeItems: 'center', background: a.kind === 'primary' ? 'rgba(255,255,255,.25)' : alpha('var(--warn)', 18),
                color: a.kind === 'primary' ? '#fff' : 'var(--warn)' }}>{a.badge}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  } else if (st.speech) {
    const a = agents[st.speech.agentId];
    dotColor = a.pm ? 'var(--pm)' : a.color;
    if (a.pm) {
      // quiet facilitator narration — show the actual line
      body = <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
        <b style={{ color: 'var(--pm)' }}>{a.displayName}</b> · {st.speech.text || 'facilitating…'}</div>;
    } else {
      const verb = st.speech.mode === 'working' ? 'is working' : st.speech.mode === 'thinking' ? 'is thinking' : 'is speaking';
      body = <div style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}><b style={{ color: a.color }}>{a.displayName}</b> {verb}…</div>;
    }
  } else {
    body = (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, fontSize: 13.5 }}>
        <span>{liveStatus === 'pending' ? 'Drafting the plan…' : !st.started ? 'Ready to begin' : 'The table is quiet'}</span>
        {!st.started && (
          <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>create a task or message the table</span>
        )}
      </div>
    );
  }
  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 22px 0' }}>
        <WorkflowStrip clock={scene.clock} onOpen={onOpenWorkflow} />
        <span style={{ flex: 1 }} />
      </div>
      {rec && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 22px 0', padding: '8px 12px',
          borderRadius: 'var(--r-sm)', border: `1px solid ${alpha('var(--accent)', 30)}`, background: alpha('var(--accent)', 8) }}>
          <Icon name="sparkle" size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45, minWidth: 0 }}>
            <span>This task fits <b>“{rec.name}”</b> better</span>
            <span style={{ color: 'var(--text-muted)' }}> — {rec.reason}</span>
          </div>
          <button onClick={() => onUseWorkflow && onUseWorkflow(rec.id)} style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 'var(--r-sm)',
            border: 'none', background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Use it</button>
          <button onClick={() => onDismissRec && onDismissRec()} title="Dismiss" style={{ flexShrink: 0, display: 'grid', placeItems: 'center',
            width: 24, height: 24, borderRadius: 'var(--r-sm)', border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }}><Icon name="x" size={13} /></button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 22px 4px' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0,
          boxShadow: st.speech ? `0 0 0 4px ${alpha(dotColor, 22)}` : 'none' }} />
        {body}
      </div>
      <Composer agents={agents} onSend={onSend || (() => scene.replay())} />
    </div>
  );
}

/* ---- Inspector : tabbed Files / Notes (right, collapsible) --------------- */
// P3.2: live message thread for the selected chat (messages.list + handoffs count).
function LiveThread({ messages, handoffs, agents }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {handoffs && handoffs.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              {handoffs.length} hand-off{handoffs.length > 1 ? 's' : ''} in this chat
            </div>
            {handoffs.map((h) => h.card && <HandoffCard key={h.id} ho={h.card} agents={agents} />)}
          </div>
        )}
        {messages.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>No messages yet.</div>
        )}
        {messages.map((m) => {
          const mine = m.authorType === 'user';
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '80%', padding: '9px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5,
                background: mine ? 'var(--accent)' : 'var(--surface-2)', color: mine ? '#fff' : 'var(--text)',
                border: mine ? 'none' : '1px solid var(--border)' }}>
                {!mine && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 2 }}>{m.authorId || m.authorType}</div>}
                {m.content}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function FileRow({ art, agents, onOpen, activeChatId }) {
  const owner = agents[art.ownerAgentId];
  const icon = art.kind === 'preview' ? 'eye' : art.kind === 'diff' ? 'code' : art.kind === 'doc' ? 'clip' : 'code';
  const fromSiblingChat = activeChatId && art.createdInChatId && art.createdInChatId !== activeChatId;
  const scopeCopy = fromSiblingChat
    ? `project artifact · from chat ${art.createdInChatId.slice(0, 8)}`
    : art.workbenchId
      ? 'project artifact'
      : null;
  return (
    <button onClick={() => onOpen(art)} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface)',
      color: 'var(--text)', font: 'inherit', cursor: 'pointer', marginBottom: 7 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface)')}>
      <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 8, flexShrink: 0,
        background: tint(owner && !art.source.includes('upload') ? owner.color : 'var(--text-faint)', 14),
        color: owner && art.source !== 'uploaded' ? owner.color : 'var(--text-muted)' }}>
        <Icon name={icon} size={15} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {art.title.split('/').pop()}</div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
          {scopeCopy || (art.source === 'uploaded' ? 'you · uploaded' : owner ? owner.displayName + ' · ' + art.kind : art.kind)}
        </div>
      </div>
      <span className="mono tnum" style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 6px', borderRadius: 5,
        background: 'var(--surface-3)', color: 'var(--text-muted)', flexShrink: 0 }}>v{art.version}</span>
    </button>
  );
}
function InspectorPanel({ tab, setTab, clock, agents, scene, width, onOpenArtifact, onAction, onClose, live, liveArtifacts, liveMessages, liveHandoffs, activeChatId, memory, localTurns, localStatus, onApproveLocalTurn }) {
  const placed = sceneAt(clock).placed;
  const hasLocalTurns = !live && localTurns && localTurns.length > 0;
  const localArtifacts = hasLocalTurns ? liveArtifactsFromTurns(localTurns, agents, localStatus) : [];
  // P3.2: in live mode show the real chat's artifacts (empty until the orchestrator runs) —
  // never fall back to scripted fixtures, which would contradict the live center stage.
  const created = hasLocalTurns
    ? localArtifacts
    : live
    ? (liveArtifacts ?? []).map((a) => ({ ...a, version: a.currentVersion, source: a.source ?? 'generated' }))
    : placed.map((p) => p.art);
  // The fixture "brief" is demo-only — in live mode there are no user-provided artifacts yet.
  const provided = live || hasLocalTurns ? [] : [RT.ARTIFACTS.brief];
  const notes = meetingNotes(clock);
  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{ flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer', font: 'inherit',
      fontSize: 12.5, fontWeight: 600, background: 'transparent', color: tab === id ? 'var(--text)' : 'var(--text-faint)',
      borderBottom: `2px solid ${tab === id ? 'var(--accent)' : 'transparent'}` }}>{label}</button>
  );
  return (
    <div style={{ width: width || 392, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)',
      display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px 0' }}>
        {tabBtn('chat', 'Chat')}
        {tabBtn('files', `Files · ${created.length + provided.length}`)}
        {tabBtn('memory', 'Memory')}
        {tabBtn('deps', 'Deps')}
        {tabBtn('notes', 'Notes')}
        <button onClick={onClose} style={{ ...iconBtn, border: 'none', background: 'transparent' }}><Icon name="x" size={15} /></button>
      </div>
      <div style={{ borderBottom: '1px solid var(--border)' }} />

      {tab === 'chat' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
          {hasLocalTurns
            ? <LocalLiveThread turns={localTurns} agents={agents} onApproveTurn={onApproveLocalTurn} />
            : live
            ? <LiveThread messages={liveMessages ?? []} handoffs={liveHandoffs} agents={agents} />
            : <Thread agents={agents} scene={scene} onOpenArtifact={onOpenArtifact} onAction={onAction} narrow />}
        </div>
      ) : tab === 'files' ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
          {provided.length > 0 && (
            <>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
                color: 'var(--text-faint)', margin: '0 0 9px' }}>Provided by you</div>
              {provided.map((a) => <FileRow key={a.id} art={a} agents={agents} onOpen={onOpenArtifact} activeChatId={activeChatId} />)}
            </>
          )}
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'var(--text-faint)', margin: provided.length > 0 ? '16px 0 9px' : '0 0 9px' }}>
            {hasLocalTurns ? 'Local model outputs' : live ? 'Project artifacts' : 'Created in this run'} · {created.length}
          </div>
          {created.length === 0
            ? <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic', padding: '4px 2px' }}>Nothing yet — artifacts land here as the team works.</div>
            : created.map((a) => <FileRow key={a.id} art={a} agents={agents} onOpen={onOpenArtifact} activeChatId={activeChatId} />)}
        </div>
      ) : tab === 'memory' ? (
        <MemoryPanel memory={memory} />
      ) : tab === 'deps' ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
          {live || hasLocalTurns ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic', padding: '4px 2px' }}>
              The dependency graph isn&rsquo;t wired to live data yet — it&rsquo;ll map artifacts as the team links them.</div>
          ) : (
            <DependencyGraphSidebar
              graph={RT.DEPENDENCY_GRAPH}
              agents={agents}
              chatId={RT.WORKBENCH?.id || 'main'}
              onNodeClick={(node) => {
                const art = Object.values(RT.ARTIFACTS).find((a) => a.id === node.artifactId);
                if (art && onOpenArtifact) onOpenArtifact(art);
              }}
            />
          )}
        </div>
      ) : live || hasLocalTurns ? (
        <LiveNotes agents={agents} artifacts={created} handoffs={liveHandoffs} />
      ) : (
        <NotesContent clock={clock} agents={agents} notes={notes} />
      )}

      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-faint)',
        display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--run)', animation: 'rt-blink 1.4s infinite' }} />
        live · kept by the facilitator
      </div>
    </div>
  );
}

/* ---- live notes: real deliverables + hand-offs for the selected chat ------ */
function LiveNotes({ agents, artifacts, handoffs }) {
  const arts = artifacts || [];
  const hos = handoffs || [];
  if (arts.length === 0 && hos.length === 0) {
    return (
      <div style={{ flex: 1, padding: '16px 16px 24px' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>
          Notes fill in as the team works — deliverables, hand-offs, and reviews land here once the orchestrator runs.</div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px' }}>
      {hos.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'var(--text-faint)', marginBottom: 8 }}>Activity</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <Icon name="layers" size={13} style={{ color: 'var(--text-faint)', marginTop: 3, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.45 }}>
                {hos.length} hand-off{hos.length > 1 ? 's' : ''} coordinated by the facilitator</span>
            </div>
            {hos.map((h) => h.card && <HandoffCard key={h.id} ho={h.card} agents={agents} />)}
          </div>
        </div>
      )}
      {arts.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'var(--text-faint)', marginBottom: 8 }}>Deliverables · {arts.length}</div>
          {arts.map((a) => {
            const ow = agents[a.ownerAgentId];
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                <Avatar agent={ow} size={20} ring={false} />
                <span className="mono" style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.title.split('/').pop()}</span>
                <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>v{a.version}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function turnToTask(turn) {
  const title = turn.message.length > 40 ? turn.message.slice(0, 40) + '...' : turn.message;
  if (turn.status === 'error') {
    return { id: turn.id, title, meta: turn.error || 'failed', status: 'queued' };
  }
  const count = turn.result?.plan?.tasks?.length || turn.plan?.tasks?.length || 0;
  const approvalStatus = turn.result?.approvalStatus || turn.approvalStatus;
  const dispatchStatus = turn.result?.dispatchStatus || turn.dispatchStatus;
  const artifactCount = turn.result?.artifacts?.length || turn.artifacts?.length || 0;
  const approvalMeta = approvalStatus === 'approved' ? 'approved' : 'awaiting approval';
  return {
    id: turn.id,
    title,
    meta: dispatchStatus === 'completed'
      ? `${artifactCount} artifacts · result ready`
      : count
      ? `${count} planned · ${approvalMeta}`
      : 'planned',
    status: approvalStatus === 'approved' ? 'done' : turn.status === 'pending' ? 'live' : 'queued',
  };
}

function storedTurnToLiveTurn(turn) {
  return {
    id: turn.id,
    message: turn.message,
    status: turn.status,
    createdAt: turn.createdAt,
    ...(turn.status === 'done'
      ? {
          result: {
            ok: true,
            id: turn.id,
            provider: turn.provider,
            model: turn.model,
            pmMessage: turn.pmMessage,
            needsApproval: turn.needsApproval,
            approvalStatus: turn.approvalStatus,
            approvedAt: turn.approvedAt,
            dispatchStatus: turn.dispatchStatus,
            dispatchAdapter: turn.dispatchAdapter,
            dispatchedAt: turn.dispatchedAt,
            dispatchStage: turn.dispatchStage,
            dispatchError: turn.dispatchError,
            dispatchWorkspacePath: turn.dispatchWorkspacePath,
            dispatch: turn.dispatch,
            artifacts: turn.artifacts,
            intake: turn.intake,
            plan: turn.plan,
          },
        }
      : { error: turn.error || 'orchestrator_turn_failed' }),
  };
}

function latestLiveTurn(liveTurns) {
  const turns = (liveTurns || []).filter((turn) => turn.result || turn.status === 'pending' || turn.status === 'error');
  if (turns.length === 0) return null;
  const timeOf = (turn) => {
    const fromCreatedAt = turn.createdAt ? Date.parse(turn.createdAt) : NaN;
    if (!Number.isNaN(fromCreatedAt)) return fromCreatedAt;
    const fromId = /^live-(\d+)$/.exec(turn.id);
    return fromId ? Number(fromId[1]) : 0;
  };
  return [...turns].sort((a, b) => timeOf(b) - timeOf(a))[0];
}

function preferredAgentAdapterRequest() {
  if (typeof window === 'undefined') return {};
  const value = window.localStorage.getItem('roundtableAgentAdapter');
  return value ? { agentAdapter: value } : {};
}

function livePlanArtifact(liveTurns, liveStatus) {
  return {
    id: 'live-code-log',
    kind: 'code',
    title: 'roundtable-live-run.json',
    ownerAgentId: 'orchestrator',
    version: 1,
    source: 'generated',
    createdAt: new Date().toISOString(),
    code: JSON.stringify({
      server: {
        status: 'running',
        url: 'http://localhost:3000',
        currentUiStatus: liveStatus,
      },
      turns: (liveTurns || []).map((turn) => ({
        id: turn.id,
        createdAt: turn.createdAt,
        status: turn.status,
        approvalStatus: turn.result?.approvalStatus,
        dispatchStatus: turn.result?.dispatchStatus,
        dispatchAdapter: turn.result?.dispatchAdapter,
        artifactCount: turn.result?.artifacts?.length || 0,
        workspacePath: turn.result?.dispatchWorkspacePath,
        taskCount: turn.result?.plan?.tasks?.length || 0,
        message: turn.message,
        error: turn.error,
        plan: turn.result?.plan,
      })),
    }, null, 2),
  };
}

function agentForArtifact(artifact, agents) {
  if (agents[artifact.ownerAgentId]) return agents[artifact.ownerAgentId];
  const role = artifact.ownerAgentId;
  return Object.values(agents).find((agent) => agent.role === role && !agent.pm) || agents.orchestrator;
}

function normalizeLiveArtifacts(artifacts, agents) {
  return (artifacts || []).map((artifact) => {
    const owner = agentForArtifact(artifact, agents);
    return {
      ...artifact,
      ownerAgentId: owner.agentId,
      source: 'generated',
      code: artifact.kind === 'code' ? artifact.preview : undefined,
      preview: artifact.preview || '',
    };
  });
}

function liveArtifactsFromTurns(liveTurns, agents, liveStatus) {
  const turns = liveTurns || [];
  return [
    ...(turns.length > 0 ? [livePlanArtifact(turns, liveStatus)] : []),
    ...turns.flatMap((turn) => normalizeLiveArtifacts(turn.result?.artifacts || [], agents)),
  ];
}

function buildLocalScene(baseScene, liveTurns, agents) {
  const latest = latestLiveTurn(liveTurns);
  if (!latest) return baseScene;
  const status = { ...baseScene.status };
  Object.keys(status).forEach((id) => { status[id] = 'idle'; });
  const result = latest.result;
  const approved = result?.approvalStatus === 'approved';
  const completed = result?.dispatchStatus === 'completed';
  status.orchestrator = latest.status === 'pending' ? 'working' : result ? 'done' : 'idle';

  const roleCursor = {};
  const ownerFor = (assignee) => {
    const role = String(assignee || '').replace(/^@/, '');
    const candidates = Object.values(agents).filter((agent) => agent.role === role && !agent.pm);
    if (candidates.length === 0) return agents.orchestrator;
    const index = roleCursor[role] || 0;
    roleCursor[role] = index + 1;
    return candidates[index % candidates.length];
  };
  const liveTasks = result?.plan?.tasks?.map((task) => {
    const owner = ownerFor(task.assignee);
    status[owner.agentId] = completed || approved ? 'done' : 'idle';
    return { ...task, owner: owner.agentId, status: completed ? 'completed' : approved ? 'running' : 'pending' };
  }) || [];

  return {
    ...baseScene,
    live: true,
    started: true,
    planPosted: true,
    run: {
      phase: latest.status === 'pending' ? 'planning' : completed ? 'completed' : approved ? 'approved' : 'approval',
      message: latest.message,
      error: latest.error,
      provider: result?.provider,
      model: result?.model,
      dispatchStatus: result?.dispatchStatus,
      artifactCount: result?.artifacts?.length || 0,
      workspacePath: result?.dispatchWorkspacePath,
    },
    status,
    tasks: liveTasks,
    placed: result?.plan ? liveArtifactsFromTurns([latest], agents, 'idle').map((art) => ({
      art,
      ownerAgentId: art.ownerAgentId,
    })) : [],
  };
}

/* ---- structured meeting notes (decisions / deliverables / review / next) - */
function NotesContent({ clock, agents, notes }) {
  const placed = sceneAt(clock).placed;
  const Section = ({ label, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
        color: 'var(--text-faint)', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
  const Item = ({ children, icon }) => (
    <div style={{ display: 'flex', gap: 9, marginBottom: 8, alignItems: 'flex-start' }}>
      <Icon name={icon || 'dot'} size={13} style={{ color: 'var(--text-faint)', marginTop: 3, flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.45 }}>{children}</span>
    </div>
  );
  const decisions = clock >= 2900;
  const reviewed = clock >= 19000;
  const doneR = clock >= 22400;
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px' }}>
      {!decisions && <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>Notes fill in as decisions are made.</div>}
      {decisions && (
        <Section label="Decisions">
          <Item icon="check">Deploy target — <b>Vercel + Postgres</b></Item>
          <Item icon="check">Server-rendered form, no client JS for submit</Item>
          <Item icon="check">Work split into <b>3 parallel tasks</b></Item>
        </Section>
      )}
      {placed.length > 0 && (
        <Section label={`Deliverables · ${placed.length}`}>
          {placed.map((p) => {
            const ow = agents[p.ownerAgentId];
            return (
              <div key={p.art.id} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                <Avatar agent={ow} size={20} ring={false} />
                <span className="mono" style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.art.title.split('/').pop()}</span>
                <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>v{p.art.version}</span>
              </div>
            );
          })}
        </Section>
      )}
      {reviewed && (
        <Section label="Review">
          <Item icon="eye">1 accessibility nit — email field needs a label. <b style={{ color: 'var(--warn)' }}>fix available</b></Item>
        </Section>
      )}
      {doneR && (
        <Section label="Next steps">
          <Item icon="wrench">Apply the review fix (1)</Item>
          <Item icon="rocket">Deploy to Vercel</Item>
        </Section>
      )}
    </div>
  );
}

/* ---- Breakout room (a real side room you can sit in) --------------------- */
function BreakoutModal({ data, agents, onClose, onBringBack }) {
  if (!data) return null;
  const [val, setVal] = useState('');
  const a = agents[data.a], b = agents[data.b];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 115, background: alpha('#000', 38),
      backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} className="rt-zoom" style={{ width: 'min(560px, 100%)', height: 'min(600px, 88vh)',
        display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 'var(--r-card)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)',
            color: 'var(--text-muted)' }}><Icon name="door" size={16} /></span>
          <span style={{ display: 'flex' }}>
            <span style={{ zIndex: 1 }}><Avatar agent={a} size={26} /></span>
            <span style={{ marginLeft: -8 }}><Avatar agent={b} size={26} /></span>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{a.displayName} &amp; {b.displayName}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>breakout · side room — you’re watching</div>
          </div>
          <span className="mono" style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 5, background: 'var(--surface-3)', color: 'var(--text-faint)' }}>{data.turns} turns</span>
          <button onClick={onClose} style={{ ...iconBtn, marginLeft: 4 }}><Icon name="x" size={15} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--bg)' }}>
          {data.transcript.map((t, i) => {
            const ag = agents[t.agentId];
            return (
              <div key={i} style={{ display: 'flex', gap: 10 }}>
                <Avatar agent={ag} size={28} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: ag.color, fontWeight: 600, marginBottom: 2 }}>{ag.displayName}</div>
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px',
                    padding: '9px 12px', fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5 }}>{t.text}</div>
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'center', fontSize: 11.5, color: 'var(--text-faint)',
            padding: '4px 12px', borderRadius: 999, background: 'var(--surface-2)' }}>
            <Icon name="check" size={12} style={{ color: 'var(--ok)' }} /> aligned — outcome ready to share
          </div>
        </div>
        <div style={{ padding: '11px 14px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9 }}>
            <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={1} placeholder="Join in — add a note to the room…"
              style={{ flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)',
                font: 'inherit', fontSize: 13.5, color: 'var(--text)', padding: '9px 11px', outline: 'none', maxHeight: 90 }} />
            <button onClick={() => setVal('')} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 'var(--r-sm)',
              border: 'none', cursor: 'pointer', background: 'var(--surface-3)', color: 'var(--text-muted)', flexShrink: 0 }}><Icon name="send" size={16} /></button>
          </div>
          <button onClick={() => { onBringBack && onBringBack(); onClose(); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            gap: 7, padding: '10px', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff',
            font: 'inherit', fontSize: 13, fontWeight: 600 }}>
            <Icon name="layers" size={15} /> Bring the outcome back to the table</button>
        </div>
      </div>
    </div>
  );
}

/* ---- BreakoutsHub : the door's panel — see & start side rooms ------------ */
function BreakoutsHub({ agents, memberIds, autoRoom, onEnterAuto, onStartDM, onClose }) {
  const members = (memberIds || []).filter((id) => id !== 'orchestrator' || true).map((id) => agents[id]).filter(Boolean);
  return (
    <Modal title="Breakout rooms" icon="door" onClose={onClose} width={500}
      sub="Pull people aside for a side conversation — two agents, or a private 1:1 with you.">
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>Active rooms</div>
      {autoRoom ? (
        <button onClick={onEnterAuto} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px',
          borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', font: 'inherit',
          textAlign: 'left', marginBottom: 18 }}>
          <span style={{ display: 'flex' }}>
            <span style={{ zIndex: 1 }}><Avatar agent={agents[autoRoom.a]} size={26} /></span>
            <span style={{ marginLeft: -8 }}><Avatar agent={agents[autoRoom.b]} size={26} /></span>
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{agents[autoRoom.a].displayName} &amp; {agents[autoRoom.b].displayName}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>aligning on validation · {autoRoom.turns} turns</div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
            Enter <Icon name="chevron" size={12} /></span>
        </button>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic', marginBottom: 18 }}>No side rooms open right now.</div>
      )}

      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>Talk privately with a member</div>
      <div style={{ display: 'grid', gap: 7 }}>
        {members.map((a) => (
          <button key={a.agentId} onClick={() => onStartDM(a.agentId)} style={{ display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface)',
            cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface)')}>
            <Avatar agent={a} size={26} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{a.displayName}</div>
              <div className="mono" style={{ fontSize: 11, color: a.color }}>{a.pm ? 'facilitator' : '@' + a.role}</div>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
              <Icon name="send" size={13} /> Message</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ---- DMRoom : a private 1:1 side room (You ↔ agent), doubles as steering -- */
function DMRoom({ agent, activeTask, onClose }) {
  if (!agent) return null;
  const [val, setVal] = useState('');
  const steering = !!activeTask;
  const redirects = ['Use Postgres, not SQLite', 'Add rate limiting', 'Keep it server-rendered'];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 115, background: alpha('#000', 34),
      backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} className="rt-zoom" style={{ width: 'min(460px, 100%)', height: 'min(560px, 86vh)',
        display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 'var(--r-card)',
        border: '1px solid var(--border)', borderTop: `2.5px solid ${agent.color}`, boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 15px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 7, background: 'var(--surface-2)',
            color: 'var(--text-muted)' }}><Icon name={steering ? 'wrench' : 'door'} size={14} /></span>
          <Avatar agent={agent} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{steering ? 'Steer' : 'Private'} · {agent.displayName}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{steering ? 'redirect them mid-task' : 'just you two — off the main table'}</div>
          </div>
          <button onClick={onClose} style={iconBtn}><Icon name="x" size={15} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 15px', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg)' }}>
          {steering && (
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 'var(--r-sm)',
              background: tint(agent.color, 9), border: `1px solid ${alpha(agent.color, 35)}` }}>
              <Spinner size={15} color={agent.color} />
              <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
                <b>Working on {activeTask}</b> right now. A note here steers the live task without stopping the table.</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 9 }}>
            <Avatar agent={agent} size={26} />
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px',
              padding: '9px 12px', fontSize: 13.5, color: 'var(--text)', maxWidth: '80%' }}>
              {steering ? 'Mid-build — tell me what to change and I’ll fold it in.' : 'Hey — what would you like to go over, just the two of us?'}</div>
          </div>
        </div>
        {steering && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 13px 4px' }}>
            {redirects.map((r) => (
              <button key={r} onClick={() => setVal(r)} style={{ padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', fontSize: 11.5 }}>{r}</button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, padding: '11px 13px', borderTop: '1px solid var(--border)' }}>
          <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={1} placeholder={steering ? `Redirect ${agent.displayName}…` : `Message ${agent.displayName} privately…`}
            style={{ flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)',
              font: 'inherit', fontSize: 13.5, color: 'var(--text)', padding: '9px 11px', outline: 'none', maxHeight: 100 }} />
          <button onClick={() => setVal('')} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 'var(--r-sm)',
            border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', flexShrink: 0 }}><Icon name="send" size={16} /></button>
        </div>
      </div>
    </div>
  );
}

/* ---- ResizeHandle : drag to resize the inspector ------------------------- */
function ResizeHandle({ onResize }) {
  const drag = useRef(null);
  useEffect(() => {
    const move = (e) => { if (drag.current != null) onResize(drag.current - e.clientX); };
    const up = () => { drag.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [onResize]);
  return (
    <div onMouseDown={(e) => { drag.current = e.clientX + 0; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }}
      title="Drag to resize" style={{ width: 7, flexShrink: 0, cursor: 'col-resize', position: 'relative', zIndex: 30,
        display: 'grid', placeItems: 'center', background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}
      onMouseEnter={(e) => (e.currentTarget.firstChild.style.background = 'var(--accent)')}
      onMouseLeave={(e) => (e.currentTarget.firstChild.style.background = 'var(--border)')}>
      <div style={{ width: 2, height: 38, borderRadius: 2, background: 'var(--border)', transition: 'background .15s' }} />
    </div>
  );
}

/* ---- ResizeHandle for the inspector. The actual onResize closure lives in App. */

/* ============================================================================ */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "aesthetic": "neutral",
  "theme": "light",
  "density": "balanced",
  "palette": "soft",
  "autoplay": false,
  "speed": 1.2
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = useState('roundtable');
  const [drawerArt, setDrawerArt] = useState(null);
  const [breakoutOpen, setBreakoutOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [dmAgent, setDmAgent] = useState(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState('chat');
  const [modal, setModal] = useState(null);
  const [railOpen, setRailOpen] = useState(true);
  const [inspectorW, setInspectorW] = useState(392);
  const [zoomWB, setZoomWB] = useState(false);
  const [memberIds, setMemberIds] = useState(RT.WORKBENCH.members);
  const [localTurns, setLocalTurns] = useState([]);
  const [localStatus, setLocalStatus] = useState('idle');
  const [localChatId] = useState(() => crypto.randomUUID());
  // P3.2: live chats when signed in; fall back to fixtures for the logged-out demo.
  const { status: authStatus } = useSession();
  const authed = authStatus === 'authenticated';
  const chatsQ = trpc.chats.list.useQuery(undefined, { enabled: authed });
  const workbenchesQ = trpc.workbenches.list.useQuery(undefined, { enabled: authed });
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [selectedWorkbenchId, setSelectedWorkbenchId] = useState(null);
  const trpcUtils = trpc.useUtils();
  const createWorkbench = trpc.workbenches.create.useMutation({
    onSuccess: () => trpcUtils.workbenches.list.invalidate(),
  });
  const createChat = trpc.chats.create.useMutation({
    onSuccess: (chat) => {
      trpcUtils.chats.list.invalidate();
      setSelectedChatId(chat.id);
      setSelectedWorkbenchId(chat.workbenchId);
    },
  });
  const updateProfile = trpc.userProfile.update.useMutation({
    onSuccess: () => trpcUtils.userProfile.get.invalidate(),
  });
  const pinWorkbench = trpc.workbenchPinned.pin.useMutation({
    onSuccess: () => trpcUtils.workbenchPinned.list.invalidate(),
  });
  const unpinWorkbench = trpc.workbenchPinned.unpin.useMutation({
    onSuccess: () => trpcUtils.workbenchPinned.list.invalidate(),
  });
  const liveWorkbenches = workbenchesQ.data ?? [];
  const activeChat =
    authed && chatsQ.data && selectedChatId
      ? chatsQ.data.find((c) => c.id === selectedChatId)
      : null;
  const firstWorkbenchId = liveWorkbenches[0]?.id ?? null;
  const activeWorkbenchId = selectedWorkbenchId ?? activeChat?.workbenchId ?? firstWorkbenchId;
  const activeChatId = selectedChatId
    ?? ((authed && chatsQ.data?.find((c) => c.workbenchId === activeWorkbenchId)?.id) || null);
  const activeWorkbench =
    authed && activeWorkbenchId
      ? liveWorkbenches.find((w) => w.id === activeWorkbenchId) ?? null
      : null;
  const localTasks = localTurns.map(turnToTask);
  const tasks =
    authed && chatsQ.data
      ? chatsQ.data
          .filter((c) => !activeWorkbenchId || c.workbenchId === activeWorkbenchId)
          .map((c) => ({ id: c.id, title: c.title, meta: activeWorkbench?.name || 'workbench', status: 'idle', workbenchId: c.workbenchId }))
      : localTasks.length > 0
        ? localTasks
        : RT.TASKS;
  const profileQ = trpc.userProfile.get.useQuery(undefined, { enabled: authed });
  const pinsQ = trpc.workbenchPinned.list.useQuery(
    { workbenchId: activeWorkbenchId ?? '' },
    { enabled: authed && !!activeWorkbenchId },
  );
  const artifactsQ = trpc.artifacts.listByChat.useQuery(
    { chatId: activeChatId ?? '' },
    { enabled: authed && !!activeChatId },
  );
  const liveArtifacts = authed && artifactsQ.data ? artifactsQ.data : null;
  const messagesQ = trpc.messages.list.useQuery(
    { chatId: activeChatId ?? '' },
    { enabled: authed && !!activeChatId },
  );
  const handoffsQ = trpc.handoffs.listByChat.useQuery(
    { chatId: activeChatId ?? '' },
    { enabled: authed && !!activeChatId },
  );
  const liveMessages = authed && messagesQ.data ? messagesQ.data : null;
  const liveHandoffs = authed && handoffsQ.data ? handoffsQ.data : null;
  const agents = useMemo(() => palettize(t.palette), [t.palette, memberIds]);
  const railWorkbench = authed && activeWorkbench
    ? { ...activeWorkbench, members: RT.WORKBENCH.members }
    : RT.WORKBENCH;
  const railWorkbenches = authed && liveWorkbenches.length > 0
    ? liveWorkbenches.map((w) => ({ ...w, members: RT.WORKBENCH.members }))
    : RT.WORKBENCHES;
  const scene = useScene(t.autoplay, t.speed);
  const compact = useMediaQuery('(max-width: 760px)');
  const [decided, setDecided] = useState(false);
  const localLive = !authed && localTurns.length > 0;
  // Workflow recommendation for the active task (local heuristic; no backend on main).
  const activeTaskTitle = localLive
    ? (tasks[0]?.title ?? '')
    : (tasks.find((tk) => tk.id === activeChatId)?.title ?? '');
  const [recDismissed, setRecDismissed] = useState(null);
  const [, setWfTick] = useState(0);
  const workflowRec = recommendWorkflow(activeTaskTitle, RT.BUILTIN_WORKFLOWS, RT.WORKBENCH.workflowId);
  const applyWorkflow = (id) => { RT.WORKBENCH.workflowId = id; setWfTick((n) => n + 1); setRecDismissed(null); };
  const effectiveRec = workflowRec && recDismissed !== workflowRec.id ? workflowRec : null;
  const st = useMemo(() => {
    const s = sceneAt(localLive ? 0 : scene.clock);
    if (decided) s.decision = null;
    return localLive ? buildLocalScene(s, localTurns, agents) : s;
  }, [scene.clock, decided, localLive, localTurns, agents]);
  useEffect(() => { if (scene.clock < 200) setDecided(false); }, [scene.clock]);
  useEffect(() => {
    if (!compact) return;
    setRailOpen(false);
    setNotesOpen(false);
  }, [compact]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (dmAgent) setDmAgent(null);
      else if (breakoutOpen) setBreakoutOpen(false);
      else if (hubOpen) setHubOpen(false);
      else if (zoomWB) setZoomWB(false);
      else if (drawerArt) setDrawerArt(null);
      else if (modal) setModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const r = document.documentElement;
    r.dataset.aesthetic = t.aesthetic;
    r.dataset.theme = t.theme;
    r.dataset.density = t.density;
  }, [t.aesthetic, t.theme, t.density]);

  useEffect(() => {
    if (authStatus === 'loading' || authed) return;
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const res = await fetch(`/api/orchestrator/history?chatId=${localChatId}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled || !res.ok || !data.ok) return;
        setLocalTurns((data.turns || []).map(storedTurnToLiveTurn));
      } catch {
        // Local history is a dev convenience; a fresh turn should still work.
      }
    };
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [authStatus, authed]);

  const onAction = (id) => {
    if (id === 'preview') setDrawerArt(RT.ARTIFACTS.preview);
    if (id === 'fix') setDrawerArt(RT.ARTIFACTS.diff);
    if (id === 'deploy') setDrawerArt(RT.ARTIFACTS.preview);
    if (id.indexOf('decide:') === 0) setDecided(true);
  };
  const pickChat = (id) => {
    setSelectedChatId(id);
    const chat = chatsQ.data?.find((c) => c.id === id);
    if (chat) setSelectedWorkbenchId(chat.workbenchId);
  };
  const pickWorkbench = (id) => {
    setSelectedWorkbenchId(id);
    const firstChat = chatsQ.data?.find((c) => c.workbenchId === id);
    setSelectedChatId(firstChat?.id ?? null);
  };
  const ensureWorkbench = async () => {
    if (activeWorkbench?.id) return activeWorkbench;
    const created = await createWorkbench.mutateAsync({
      name: 'Product Squad',
      workspacePath: `workspaces/${Date.now()}`,
      description: 'Default workbench created from the Roundtable UI.',
    });
    setSelectedWorkbenchId(created.id);
    return created;
  };
  const sendLocalTurn = async (message, turnId) => {
    const id = turnId || 'live-' + Date.now();
    const createdAt = new Date().toISOString();
    setInspectorTab('chat');
    setNotesOpen(true);
    setLocalStatus('pending');
    setLocalTurns((turns) => [{ id, message, createdAt, status: 'pending' }, ...turns]);
    try {
      const res = await fetch('/api/orchestrator/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, turnId: id, chatId: localChatId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'orchestrator_turn_failed');
      }
      setLocalTurns((turns) => turns.map((turn) => (
        turn.id === id ? { ...turn, status: 'done', result: data } : turn
      )));
      setLocalStatus('idle');
    } catch (error) {
      const errorText = error instanceof Error ? error.message : 'orchestrator_turn_failed';
      setLocalTurns((turns) => turns.map((turn) => (
        turn.id === id ? { ...turn, status: 'error', error: errorText } : turn
      )));
      setLocalStatus('error');
    }
  };
  const approveLocalTurn = async (turnId) => {
    setLocalTurns((turns) => turns.map((turn) => (
      turn.id === turnId ? { ...turn, approving: true, approvalError: null } : turn
    )));
    try {
      const res = await fetch('/api/orchestrator/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turnId,
          decision: 'approve',
          autoDispatch: true,
          ...preferredAgentAdapterRequest(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'approval_failed');
      }
      setLocalTurns((turns) => turns.map((turn) => (
        turn.id === turnId
          ? {
              ...turn,
              approving: false,
              approvalError: null,
              result: {
                ...turn.result,
                needsApproval: data.needsApproval,
                approvalStatus: data.approvalStatus,
                approvedAt: data.approvedAt,
                dispatchStatus: data.dispatchStatus,
                dispatchAdapter: data.dispatchAdapter,
                dispatchedAt: data.dispatchedAt,
                dispatchStage: data.dispatchStage,
                dispatchError: data.dispatchError,
                dispatchWorkspacePath: data.workspacePath,
                dispatch: data.records,
                artifacts: data.artifacts,
              },
            }
          : turn
      )));
    } catch (error) {
      const errorText = error instanceof Error ? error.message : 'approval_failed';
      setLocalTurns((turns) => turns.map((turn) => (
        turn.id === turnId ? { ...turn, approving: false, approvalError: errorText } : turn
      )));
    }
  };
  const createLocalTask = (goal) => {
    setModal(null);
    setView('roundtable');
    setInspectorTab('chat');
    setNotesOpen(true);
    sendLocalTurn(goal);
  };
  const sendComposerMessage = async (message) => {
    if (authed) {
      const workbench = await ensureWorkbench();
      createChat.mutate({ title: message.slice(0, 160), workbenchId: workbench.id });
      return;
    }
    sendLocalTurn(message);
  };
  const memory = {
    live: authed,
    workbench: activeWorkbench,
    profile: profileQ.data,
    pins: pinsQ.data ?? [],
    profileSaving: updateProfile.isPending,
    pinSaving: pinWorkbench.isPending || unpinWorkbench.isPending,
    profileError: updateProfile.error?.message,
    pinError: pinWorkbench.error?.message || unpinWorkbench.error?.message,
    onSaveProfile: (patch) => updateProfile.mutate(patch),
    onAddPin: (content) => {
      if (!activeWorkbenchId) return;
      pinWorkbench.mutate({ workbenchId: activeWorkbenchId, content });
    },
    onRemovePin: (id) => {
      if (!activeWorkbenchId) return;
      unpinWorkbench.mutate({ workbenchId: activeWorkbenchId, id });
    },
  };
  const breakoutData = RT.SCRIPT.find((b) => b.kind === 'breakout');

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar t={t} setTweak={setTweak} view={view} setView={setView} />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {railOpen && !compact && <ConversationRail workbench={railWorkbench} workbenches={railWorkbenches}
          tasks={tasks} agents={agents} activeId={authed ? activeChatId : tasks[0]?.id} onPick={authed ? pickChat : undefined}
          memberIds={memberIds} onRemoveMember={(id) => setMemberIds((m) => m.filter((x) => x !== id))}
          onAddMember={() => setModal('agent')} onNewTask={() => setModal('task')} onNewWorkbench={() => setModal('table')}
          onPickWorkbench={pickWorkbench} onCollapse={() => setRailOpen(false)} />}
        {railOpen && compact && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 110, background: alpha('#000', 30), display: 'flex' }}
            onClick={() => setRailOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(320px, 86vw)', height: '100%' }}>
              <ConversationRail workbench={railWorkbench} workbenches={railWorkbenches}
                tasks={tasks} agents={agents} activeId={authed ? activeChatId : tasks[0]?.id} onPick={authed ? pickChat : undefined}
                memberIds={memberIds} onRemoveMember={(id) => setMemberIds((m) => m.filter((x) => x !== id))}
                onAddMember={() => setModal('agent')} onNewTask={() => setModal('task')} onNewWorkbench={() => setModal('table')}
                onPickWorkbench={pickWorkbench} onCollapse={() => setRailOpen(false)} />
            </div>
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)', position: 'relative' }}>
          {!railOpen && (
            <button onClick={() => setRailOpen(true)} title="Show sidebar" style={{ position: 'absolute', top: 12, left: 12, zIndex: 60,
              display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 'var(--r-sm)', cursor: 'pointer',
              border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', boxShadow: 'var(--shadow-card)' }}>
              <Icon name="layers" size={16} />
            </button>
          )}
          {view === 'roundtable' && (
            <>
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0 }}>
                    {/* The roundtable IS the centre — always. Live per-chat data (thread, files)
                        lives in the Inspector panel; the scene stays the visual identity. */}
                    <RoundtableScene agents={agents} scene={st} onOpenArtifact={setDrawerArt}
                      onAction={onAction} onOpenBreakouts={() => setHubOpen(true)} onSeatClick={(id) => setDmAgent(id)}
                      onOpenFiles={() => { setInspectorTab('files'); setNotesOpen(true); }}
                      onZoomWhiteboard={() => setZoomWB(true)} wide={!railOpen && !notesOpen} memberIds={memberIds} />
                    {authed && activeChatId && !localLive && (
                      <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 40,
                        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 13px', borderRadius: 'var(--r-chip)',
                        border: '1px solid var(--border)', background: 'color-mix(in oklab, var(--surface) 90%, transparent)',
                        backdropFilter: 'blur(6px)', boxShadow: 'var(--shadow-card)', maxWidth: '60%' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--run)', flexShrink: 0 }} />
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {localLive ? tasks[0]?.title : tasks.find((tk) => tk.id === activeChatId)?.title ?? 'Untitled task'}</span>
                      </div>
                    )}
                    {!notesOpen && (
                      <button onClick={() => setNotesOpen(true)} style={{ position: 'absolute', top: 14, right: 14, zIndex: 50,
                        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 'var(--r-chip)',
                        border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)',
                        font: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', boxShadow: 'var(--shadow-card)' }}>
                        <Icon name="layers" size={14} /> Panel
                      </button>
                    )}
                    {!st.started && !activeChatId && !localLive && (
                      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 45, pointerEvents: 'none' }}>
                        <div className="rt-rise" style={{ pointerEvents: 'auto', width: 'min(420px, 84%)', textAlign: 'center',
                          background: 'color-mix(in oklab, var(--surface) 92%, transparent)', backdropFilter: 'blur(6px)',
                          border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-pop)', padding: '22px 24px' }}>
                          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><LogoMark size={30} /></div>
                          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 5 }}>Product Squad is ready</div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
                            A full team and a proven workflow, out of the box. Describe what to build — the facilitator plans it and the table gets to work.</div>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                            {['Plan', 'Build', 'Review', 'Ship'].map((s, i) => (
                              <React.Fragment key={s}>
                                {i > 0 && <Icon name="chevron" size={12} style={{ color: 'var(--text-faint)', alignSelf: 'center' }} />}
                                <span style={{ fontSize: 11.5, fontWeight: 500, padding: '3px 10px', borderRadius: 4,
                                  background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{s}</span>
                              </React.Fragment>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 9, justifyContent: 'center' }}>
                            <button onClick={() => setModal('task')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px',
                              borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff',
                              font: 'inherit', fontSize: 13, fontWeight: 500 }}><Icon name="plus" size={15} /> Start a task</button>
                          </div>
                        </div>
                      </div>
                    )}
                </div>
                {notesOpen && !compact && <ResizeHandle onResize={(dx) => setInspectorW((w) => Math.max(300, Math.min(640, w + dx)))} />}
                {notesOpen && <InspectorPanel tab={inspectorTab} setTab={setInspectorTab} clock={scene.clock} width={compact ? 'min(100vw, 420px)' : inspectorW}
                  agents={agents} scene={scene} live={authed && !!activeChatId} liveArtifacts={liveArtifacts} liveMessages={liveMessages}
                  liveHandoffs={liveHandoffs} activeChatId={activeChatId} memory={memory}
                  localTurns={localTurns} localStatus={localStatus} onApproveLocalTurn={approveLocalTurn}
                  onOpenArtifact={setDrawerArt} onAction={onAction} onClose={() => setNotesOpen(false)} />}
              </div>
              <Dock st={st} agents={agents} scene={scene} onAction={onAction}
                onOpenChat={() => { setInspectorTab('chat'); setNotesOpen(true); }}
                onOpenWorkflow={() => setView('workflow')} onSend={sendComposerMessage} liveStatus={localStatus}
                rec={effectiveRec} onUseWorkflow={applyWorkflow} onDismissRec={() => setRecDismissed(workflowRec?.id)} />
            </>
          )}
          {view === 'workflow' && <WorkflowView agents={agents} onAddAgent={() => setModal('agent')} onOpenTemplates={() => setModal('table')} />}
        </div>
      </div>

      {drawerArt && <Drawer art={drawerArt} agents={agents} onClose={() => setDrawerArt(null)} />}
      {zoomWB && <WhiteboardZoom tasks={st.tasks} agents={agents} live={st.live} run={st.run} posted={st.planPosted} onClose={() => setZoomWB(false)} />}
      {breakoutOpen && <BreakoutModal data={breakoutData} agents={agents} onClose={() => setBreakoutOpen(false)}
        onBringBack={() => { setInspectorTab('notes'); setNotesOpen(true); }} />}
      {hubOpen && <BreakoutsHub agents={agents} memberIds={memberIds} autoRoom={st.breakout ? breakoutData : null}
        onEnterAuto={() => { setHubOpen(false); setBreakoutOpen(true); }}
        onStartDM={(id) => { setHubOpen(false); setDmAgent(id); }} onClose={() => setHubOpen(false)} />}
      {dmAgent && <DMRoom agent={agents[dmAgent]}
        activeTask={(['working', 'speaking', 'thinking'].includes(st.status[dmAgent])) ? (RT.PLAN.tasks.find((tk) => tk.owner === dmAgent) || {}).id : null}
        onClose={() => setDmAgent(null)} />}
      {modal === 'task' && <NewTaskModal workbench={railWorkbench} members={memberIds} agents={agents}
        onClose={() => setModal(null)} onCreate={async (goal) => {
          if (authed) {
            const workbench = await ensureWorkbench();
            createChat.mutate({ title: goal.slice(0, 160), workbenchId: workbench.id });
          } else {
            createLocalTask(goal);
          }
          setModal(null);
        }} />}
      {modal === 'table' && <NewWorkbenchModal agents={agents} onClose={() => setModal(null)} onCreate={(input) => {
        if (authed) {
          createWorkbench.mutate({
            name: input.name,
            workspacePath: `workspaces/${Date.now()}`,
            description: `Created from ${input.workflowId}.`,
          }, {
            onSuccess: (workbench) => {
              setSelectedWorkbenchId(workbench.id);
              setSelectedChatId(null);
            },
          });
        }
        setView('workflow');
        setModal(null);
      }} />}
      {modal === 'agent' && <AddAgentModal onClose={() => setModal(null)} onAdd={({ role, name, color }) => {
        const id = 'a-' + Date.now();
        RT.AGENTS[id] = { agentId: id, role, displayName: name, color };
        setMemberIds((m) => [...m, id]);
        setModal(null);
      }} />}
      {/* dev tweaks panel removed in port */}
    </div>
  );
}

export default App;
