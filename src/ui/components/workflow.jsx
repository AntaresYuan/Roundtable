/* ============================================================================
   Roundtable — workflow.jsx
   The packaged, customizable WORKFLOW as a first-class surface.
   Novices start from a proven workflow; power users reshape every stage via the
   StageDrawer. Backed by ONE editable Workflow object (contracts/workflow.ts,
   specs/090-workflows.md, ADR-009) — seats, parallelGroup, Gate union; never a canvas.
   ============================================================================ */
import React from 'react';
import { RT } from '../lib/rt';
import { Avatar, Icon, alpha, tint } from './primitives';
const { useState: useStateW, useEffect: useEffectW } = React;

const ROLES = ['architect', 'planner', 'implementer', 'reviewer', 'fixer'];
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit',
  fontSize: 12.5, fontWeight: 500, cursor: 'pointer' };

const seatColor = (s, agents) => {
  if (s.ref.kind === 'user') return 'var(--text-muted)';
  const a = s.ref.agentId && agents[s.ref.agentId];
  return a ? a.color : (RT.ROLE_COLORS[s.ref.role] || 'var(--text-faint)');
};
const seatLabel = (s, agents) => {
  if (s.ref.kind === 'user') return 'You';
  const a = s.ref.agentId && agents[s.ref.agentId];
  return a ? a.displayName : '@' + s.ref.role;
};
const gateLabel = (gate) =>
  !gate || gate.kind === 'none' ? null : gate.kind === 'user_approval' ? 'My approval' : 'Reviewer sign-off';

function Toggle({ on, onClick, label }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'none',
      border: 'none', cursor: 'pointer', font: 'inherit', padding: 0, color: 'var(--text-muted)' }}>
      <span style={{ width: 30, height: 18, borderRadius: 999, padding: 2, background: on ? 'var(--accent)' : 'var(--surface-3)',
        transition: 'background .15s', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start' }}>
        <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} />
      </span>
      <span style={{ fontSize: 11.5 }}>{label}</span>
    </button>
  );
}

/* ---- WhoChips : renders Seat[] (user / role[+agent]) --------------------- */
function WhoChips({ seats, agents, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {seats.map((s, i) => {
        const color = seatColor(s, agents);
        const a = s.ref.kind === 'role' && s.ref.agentId ? agents[s.ref.agentId] : null;
        return (
          <span key={i} className="rt-member" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 9px 3px 4px', borderRadius: 999, background: 'var(--surface-2)', border: `1px solid ${alpha(color, 35)}` }}>
            {a ? <Avatar agent={a} size={18} ring={false} />
              : <span style={{ width: 18, height: 18, borderRadius: '50%', background: alpha(color, 18), color,
                  display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700 }}>
                  {s.ref.kind === 'user' ? 'U' : s.ref.role[0].toUpperCase()}</span>}
            <span style={{ fontSize: 11.5 }}>{seatLabel(s, agents)}</span>
            {onRemove && <button onClick={() => onRemove(i)} className="rt-member-x" title="Remove" style={{ position: 'absolute', top: -5, right: -5,
              width: 15, height: 15, borderRadius: '50%', border: 'none', background: 'var(--bad)', color: '#fff', cursor: 'pointer',
              display: 'none', placeItems: 'center', padding: 0 }}><Icon name="x" size={9} /></button>}
          </span>
        );
      })}
      {seats.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>no one yet</span>}
    </div>
  );
}

function StageCard({ stage, idx, agents, onToggle, onRemove, onEdit, onMove, onCustomize, canLeft, canRight }) {
  const moveBtn = (enabled) => ({ width: 22, height: 24, borderRadius: 7, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text-muted)', cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.35, display: 'grid', placeItems: 'center', padding: 0 });
  const editFocus = (e) => (e.currentTarget.style.borderColor = 'var(--border)');
  const editBlur = (e) => (e.currentTarget.style.borderColor = 'transparent');
  const gated = gateLabel(stage.gate);
  return (
    <div style={{ width: 234, flexShrink: 0, background: 'var(--surface)', borderRadius: 'var(--r-card)',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', position: 'relative' }}>
      {stage.parallelGroup && <div style={{ position: 'absolute', inset: 0, borderRadius: 'var(--r-card)', pointerEvents: 'none',
        boxShadow: `0 8px 0 -4px var(--surface), 0 9px 0 -4px var(--border), 0 16px 0 -8px var(--surface), 0 17px 0 -8px var(--border)` }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 13px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 9, flexShrink: 0,
          background: tint('var(--accent)', 13), color: 'var(--accent)' }}><Icon name={stage.icon} size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input value={stage.name} onChange={(e) => onEdit('name', e.target.value)} title="Rename stage" spellCheck={false}
            onFocus={editFocus} onBlur={editBlur}
            style={{ width: '100%', font: 'inherit', fontSize: 13.5, fontWeight: 700, color: 'var(--text)', background: 'transparent',
              border: '1px solid transparent', borderRadius: 6, outline: 'none', padding: '1px 4px', margin: '-1px -4px' }} />
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: 3 }}>
            stage {idx + 1}{stage.parallelGroup ? ' · parallel' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          <button onClick={() => canLeft && onMove(-1)} disabled={!canLeft} title="Move earlier" style={moveBtn(canLeft)}>
            <Icon name="chevron" size={11} style={{ transform: 'rotate(180deg)' }} /></button>
          <button onClick={() => canRight && onMove(1)} disabled={!canRight} title="Move later" style={moveBtn(canRight)}>
            <Icon name="chevron" size={11} /></button>
          {!stage.fixed && onRemove && <button onClick={onRemove} title="Remove stage" style={{ width: 24, height: 24, borderRadius: 7,
            border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-faint)', cursor: 'pointer',
            display: 'grid', placeItems: 'center', padding: 0 }}><Icon name="x" size={12} /></button>}
        </div>
      </div>
      <div style={{ padding: '12px 13px' }}>
        <textarea value={stage.desc} onChange={(e) => onEdit('desc', e.target.value)} rows={2} title="Edit description" spellCheck={false}
          onFocus={editFocus} onBlur={editBlur}
          style={{ width: '100%', font: 'inherit', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 11,
            minHeight: 38, resize: 'vertical', background: 'transparent', border: '1px solid transparent', borderRadius: 6,
            outline: 'none', padding: '4px', boxSizing: 'border-box' }} />
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 7 }}>Who runs it</div>
        <WhoChips seats={stage.seats} agents={agents} />
        {gated && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10, padding: '3px 9px', borderRadius: 999,
            background: alpha('var(--warn)', 14), color: 'var(--warn)', fontSize: 11, fontWeight: 600 }}>
            <Icon name="eye" size={11} /> Gate · {gated}</div>
        )}
        {!stage.fixed && (
          <>
            <div style={{ display: 'flex', gap: 14, marginTop: 13, paddingTop: 11, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <Toggle on={!!stage.parallelGroup} onClick={() => onToggle('parallel')} label="Parallel" />
              <Toggle on={!!gated} onClick={() => onToggle('gate')} label="Gate" />
            </div>
            <button onClick={onCustomize} style={{ ...ghostBtn, width: '100%', justifyContent: 'center', marginTop: 11, fontWeight: 600 }}>
              <Icon name="sparkle" size={13} /> Customize</button>
          </>
        )}
      </div>
    </div>
  );
}

function AddStageButton({ onClick }) {
  return (
    <button onClick={onClick} title="Add stage" style={{ flexShrink: 0, alignSelf: 'center', width: 30, height: 30, borderRadius: '50%',
      border: '1.5px dashed var(--border-strong)', background: 'var(--surface)', color: 'var(--text-faint)', cursor: 'pointer',
      display: 'grid', placeItems: 'center', margin: '0 -7px', zIndex: 2 }}><Icon name="plus" size={14} /></button>
  );
}

/* ---- StageDrawer : per-stage deep editor (slide-over, not a modal) -------- */
function RolePicker({ onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {ROLES.map((r) => (
        <button key={r} onClick={() => onPick({ kind: 'role', role: r })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 999, cursor: 'pointer', font: 'inherit', fontSize: 12,
          border: `1px solid ${alpha(RT.ROLE_COLORS[r], 40)}`, background: 'var(--surface)', color: 'var(--text)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: RT.ROLE_COLORS[r] }} />@{r}</button>
      ))}
      <button onClick={() => onPick({ kind: 'user' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 10px', borderRadius: 999, cursor: 'pointer', font: 'inherit', fontSize: 12,
        border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-muted)' }} />+ You</button>
    </div>
  );
}

function StageDrawer({ stage, agents, onClose, onAddSeat, onRemoveSeat, onSetGate, onToggleParallel }) {
  const gk = stage.gate ? stage.gate.kind : 'none';
  const Section = ({ label, children }) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 9 }}>{label}</div>
      {children}
    </div>
  );
  const gateOpt = (val, label, hint) => (
    <button onClick={() => onSetGate(val)} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px', borderRadius: 'var(--r-sm)', cursor: 'pointer', font: 'inherit', marginBottom: 7,
      background: gk === val ? tint('var(--accent)', 8) : 'var(--surface-2)', border: `1.5px solid ${gk === val ? 'var(--accent)' : 'var(--border)'}` }}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', marginTop: 1, flexShrink: 0,
        border: `1.5px solid ${gk === val ? 'var(--accent)' : 'var(--border-strong)'}`, background: gk === val ? 'var(--accent)' : 'transparent' }} />
      <span><span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-faint)' }}>{hint}</span></span>
    </button>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 110, background: alpha('#000', 28), display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} className="rt-rise" style={{ width: 'min(420px, 94vw)', height: '100%', background: 'var(--surface)',
        borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 9, background: tint('var(--accent)', 13), color: 'var(--accent)' }}>
            <Icon name={stage.icon} size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{stage.name}</div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>Customize stage</div>
          </div>
          <button onClick={onClose} style={{ ...ghostBtn, padding: 8 }}><Icon name="x" size={15} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          <Section label="Who runs it">
            <div style={{ marginBottom: 11 }}><WhoChips seats={stage.seats} agents={agents} onRemove={onRemoveSeat} /></div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 7 }}>Add a role or yourself:</div>
            <RolePicker onPick={onAddSeat} />
          </Section>
          <Section label="Approval gate">
            {gateOpt('none', 'No gate', 'Stage completes and the run moves on.')}
            {gateOpt('user_approval', 'Requires my approval', 'The run pauses until you click continue.')}
            {gateOpt('reviewer_signoff', 'Requires reviewer sign-off', 'A @reviewer must clear open comments first.')}
          </Section>
          <Section label="Parallelism">
            <Toggle on={!!stage.parallelGroup} onClick={onToggleParallel} label="Run alongside the next stage" />
          </Section>
          <Section label="Instructions & skills">
            <div style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>
              Per-seat instructions, mounted skills, and the hand-off preview land in a later pass (spec 090 §S3).
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function WorkflowView({ agents, onOpenTemplates }) {
  const [stages, setStages] = useStateW(() =>
    RT.WORKFLOW.stages.map((s) => ({ ...s, seats: s.seats.map((x) => ({ ...x, ref: { ...x.ref } })) })),
  );
  const [saved, setSaved] = useStateW(false);
  const [drawer, setDrawer] = useStateW(null); // open stage index or null
  useEffectW(() => {
    try {
      const raw = localStorage.getItem('rt.workflows');
      if (raw) RT.workflows = JSON.parse(raw);
    } catch { /* ignore */ }
  }, []);

  const saveTemplate = () => {
    const wf = {
      id: 'wf-user-' + ((RT.workflows || []).length + 1), name: RT.WORKBENCH.name + ' workflow', tag: 'Yours',
      desc: 'Saved from this workbench — ' + stages.map((s) => s.name).join(' → ') + '.',
      origin: { kind: 'user' }, planning: RT.WORKFLOW.planning, stages, version: 1, updatedAt: new Date().toISOString(),
    };
    RT.workflows = [...(RT.workflows || []), wf];
    try { localStorage.setItem('rt.workflows', JSON.stringify(RT.workflows)); } catch { /* ignore */ }
    setSaved(true); setTimeout(() => setSaved(false), 2600);
  };

  const patch = (i, fn) => setStages((ss) => ss.map((s, j) => (j === i ? fn(s) : s)));
  const editStage = (i, field, val) => patch(i, (s) => ({ ...s, [field]: val }));
  const toggle = (i, key) => patch(i, (s) => {
    if (key === 'parallel') return { ...s, parallelGroup: s.parallelGroup ? undefined : s.id + '-grp' };
    if (key === 'gate') return { ...s, gate: s.gate && s.gate.kind !== 'none' ? { kind: 'none' } : { kind: 'user_approval' } };
    return s;
  });
  const setGate = (i, kind) => patch(i, (s) => ({
    ...s,
    gate: kind === 'reviewer_signoff'
      ? { kind, reviewer: { kind: 'role', role: 'reviewer' }, blockOn: 'open_comments' }
      : { kind },
  }));
  const addSeat = (i, ref) => patch(i, (s) => ({ ...s, seats: [...s.seats, { ref }] }));
  const removeSeat = (i, seatIdx) => patch(i, (s) => ({ ...s, seats: s.seats.filter((_, k) => k !== seatIdx) }));
  const moveStage = (i, dir) => setStages((ss) => {
    const j = i + dir;
    if (j < 0 || j >= ss.length) return ss;
    const n = [...ss];
    const [m] = n.splice(i, 1);
    n.splice(j, 0, m);
    return n;
  });
  const removeStage = (i) => setStages((ss) => ss.filter((_, j) => j !== i));
  const addStage = (i) => setStages((ss) => {
    const n = [...ss];
    n.splice(i, 0, { id: 'custom-' + Date.now(), name: 'New stage', icon: 'dot', kind: 'custom', desc: 'Describe what happens here.', seats: [], gate: { kind: 'none' } });
    return n;
  });

  const reviewGate = stages.some((s) => s.gate && s.gate.kind !== 'none');
  const chip = (on, label) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 999,
      background: on ? alpha('var(--ok)', 13) : 'var(--surface-3)', color: on ? 'var(--ok)' : 'var(--text-faint)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? 'var(--ok)' : 'var(--text-faint)' }} />{label}</span>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 60px', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h2 style={{ margin: '0 0 5px', fontSize: 21, fontWeight: 700, letterSpacing: '-.01em' }}>Workflow</h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 620 }}>
              A workflow is the <b>packaged process</b> your workbench runs every time. Start from a proven one and ship,
              or reshape any stage to build your own.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onOpenTemplates} style={ghostBtn}><Icon name="layers" size={14} /> Start from template</button>
            <button onClick={saveTemplate} style={{ ...ghostBtn, background: saved ? 'var(--ok)' : 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600 }}>
              <Icon name="check" size={14} /> {saved ? 'Saved to gallery' : 'Save as my workflow'}</button>
          </div>
        </div>

        {/* quality rail — quality is the spec's visible identity (spec 090 §S2) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 22px', padding: '11px 15px',
          borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />{RT.WORKFLOW.name}</span>
          <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
          {chip(reviewGate, 'Review gate')}
          {chip(true, 'Dependency-sync')}
          {chip(RT.WORKFLOW.planning.cut === 'by_role', 'Plan: by role')}
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--run)' }} /> runs on every task</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto', paddingBottom: 14 }}>
          {stages.map((s, i) => (
            <React.Fragment key={s.id}>
              {i > 0 && <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <div style={{ width: 26, height: 2, background: 'var(--border-strong)' }} />
                <AddStageButton onClick={() => addStage(i)} />
                <div style={{ width: 26, height: 2, background: 'var(--border-strong)' }} />
                <Icon name="chevron" size={15} style={{ color: 'var(--text-faint)', marginLeft: -6 }} />
              </div>}
              <StageCard stage={s} idx={i} agents={agents}
                onToggle={(k) => toggle(i, k)} onRemove={() => removeStage(i)}
                onEdit={(field, val) => editStage(i, field, val)} onMove={(dir) => moveStage(i, dir)}
                onCustomize={() => setDrawer(i)}
                canLeft={i > 0} canRight={i < stages.length - 1} />
            </React.Fragment>
          ))}
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="sparkle" size={13} /> Every task this workbench runs follows these stages — change them once, and the whole team adapts.
        </div>
      </div>

      {drawer != null && stages[drawer] && (
        <StageDrawer stage={stages[drawer]} agents={agents} onClose={() => setDrawer(null)}
          onAddSeat={(ref) => addSeat(drawer, ref)} onRemoveSeat={(k) => removeSeat(drawer, k)}
          onSetGate={(kind) => setGate(drawer, kind)} onToggleParallel={() => toggle(drawer, 'parallel')} />
      )}
    </div>
  );
}

export { WorkflowView };

/* ---- WorkflowStrip : live progress, shown on the Roundtable page --------- */
function currentStageIndex(clock) {
  if (clock < 700) return 0;       // intake
  if (clock < 3600) return 1;      // plan
  if (clock < 18000) return 2;     // build
  if (clock < 22400) return 3;     // review
  return 4;                        // ship
}
function WorkflowStrip({ clock, onOpen }) {
  const stages = RT.WORKFLOW.stages;
  const cur = currentStageIndex(clock);
  return (
    <div className="rt-workflow-strip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%',
      padding: '6px 8px 6px 12px', borderRadius: 999, overflow: 'hidden',
      background: 'color-mix(in oklab, var(--surface) 88%, transparent)', backdropFilter: 'blur(8px)',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginRight: 4 }}>Workflow</span>
      {stages.map((s, i) => {
        const done = i < cur, active = i === cur;
        return (
          <React.Fragment key={s.id}>
            {i > 0 && <span className="rt-workflow-connector" style={{ width: 12, height: 1.5, flexShrink: 0,
              background: done || active ? 'var(--accent)' : 'var(--border-strong)' }} />}
            <span className={`rt-workflow-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`} title={s.desc}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, padding: '4px 9px', borderRadius: 999,
              background: active ? 'var(--accent)' : done ? tint('var(--accent)', 14) : 'transparent',
              color: active ? '#fff' : done ? 'var(--accent)' : 'var(--text-faint)', fontSize: 11.5, fontWeight: active ? 600 : 500 }}>
              {done ? <Icon name="check" size={12} /> : <Icon name={s.icon} size={12} />}
              {(active || done) && <span className="rt-workflow-label">{s.name}</span>}
            </span>
          </React.Fragment>
        );
      })}
      <button onClick={onOpen} title="Open workflow" style={{ marginLeft: 4, display: 'grid', placeItems: 'center', width: 24, height: 24,
        flexShrink: 0,
        borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>
        <Icon name="expand" size={12} />
      </button>
    </div>
  );
}

export { WorkflowStrip, currentStageIndex };
