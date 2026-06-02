/* ============================================================================
   Roundtable — workflow.jsx
   The packaged, customizable WORKFLOW as a first-class surface.
   Novices start from a proven workflow; power users reshape every stage.
   This is the process the team runs at the table, made visible and editable.
   ============================================================================ */
import React from 'react';
import { RT } from '../lib/rt';
import { Avatar, Icon, alpha, tint } from './primitives';
const { useState: useStateW, useEffect: useEffectW } = React;
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit',
  fontSize: 12.5, fontWeight: 500, cursor: 'pointer' };

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

function WhoChips({ who, agents, onRemove, onAdd }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {who.map((id) => {
        if (id === 'user') return (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px 3px 4px', borderRadius: 999,
            background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--surface-3)', display: 'grid',
              placeItems: 'center', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)' }}>U</span>
            <span style={{ fontSize: 11.5 }}>You</span>
          </span>
        );
        const a = agents[id]; if (!a) return null;
        return (
          <span key={id} className="rt-member" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 9px 3px 4px', borderRadius: 999, background: 'var(--surface-2)', border: `1px solid ${alpha(a.color, 35)}` }}>
            <Avatar agent={a} size={18} ring={false} /><span style={{ fontSize: 11.5 }}>{a.displayName}</span>
            {onRemove && <button onClick={() => onRemove(id)} className="rt-member-x" style={{ position: 'absolute', top: -5, right: -5,
              width: 15, height: 15, borderRadius: '50%', border: 'none', background: 'var(--bad)', color: '#fff', cursor: 'pointer',
              display: 'none', placeItems: 'center', padding: 0 }}><Icon name="x" size={9} /></button>}
          </span>
        );
      })}
      {onAdd && <button onClick={onAdd} title="Assign agent" style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid',
        placeItems: 'center', border: '1.5px dashed var(--border-strong)', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }}>
        <Icon name="plus" size={12} /></button>}
    </div>
  );
}

function StageCard({ stage, idx, agents, onToggle, onRemove, onAddAgent, onRemoveAgent, onEdit, onMove, canLeft, canRight }) {
  const moveBtn = (enabled) => ({ width: 22, height: 24, borderRadius: 7, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text-muted)', cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.35, display: 'grid', placeItems: 'center', padding: 0 });
  const editFocus = (e) => (e.currentTarget.style.borderColor = 'var(--border)');
  const editBlur = (e) => (e.currentTarget.style.borderColor = 'transparent');
  return (
    <div style={{ width: 230, flexShrink: 0, background: 'var(--surface)', borderRadius: 'var(--r-card)',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', position: 'relative' }}>
      {stage.parallel && <div style={{ position: 'absolute', inset: 0, borderRadius: 'var(--r-card)', pointerEvents: 'none',
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
            stage {idx + 1}{stage.parallel ? ' · parallel' : ''}</div>
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
        <WhoChips who={stage.who} agents={agents} onRemove={stage.fixed ? null : (id) => onRemoveAgent(id)} onAdd={stage.fixed ? null : onAddAgent} />
        {!stage.fixed && (
          <div style={{ display: 'flex', gap: 14, marginTop: 13, paddingTop: 11, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <Toggle on={!!stage.parallel} onClick={() => onToggle('parallel')} label="Parallel" />
            <Toggle on={!!stage.gate} onClick={() => onToggle('gate')} label="Approval gate" />
          </div>
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

function WorkflowView({ agents, onAddAgent, onOpenTemplates }) {
  const [stages, setStages] = useStateW(() => RT.WORKFLOW.stages.map((s) => ({ ...s, who: [...s.who] })));
  const [saved, setSaved] = useStateW(false);
  // hydrate workflows the user saved in a previous session
  useEffectW(() => {
    try {
      const raw = localStorage.getItem('rt.userTemplates');
      if (raw) RT.userTemplates = JSON.parse(raw);
    } catch { /* ignore */ }
  }, []);
  const saveTemplate = () => {
    const tpl = { id: 'tpl-' + Date.now(), name: RT.WORKBENCH.name + ' workflow', tag: 'Yours',
      desc: 'Saved from this workbench — ' + stages.map((s) => s.name).join(' → ') + '.',
      roles: ['planner', 'implementer', 'reviewer'],
      pipe: stages.map((s) => ({ icon: s.icon, label: s.name })) };
    RT.userTemplates = [...(RT.userTemplates || []), tpl];
    try { localStorage.setItem('rt.userTemplates', JSON.stringify(RT.userTemplates)); } catch { /* ignore */ }
    setSaved(true); setTimeout(() => setSaved(false), 2600);
  };
  const toggle = (i, key) => setStages((ss) => ss.map((s, j) => (j === i ? { ...s, [key]: !s[key] } : s)));
  const editStage = (i, field, val) => setStages((ss) => ss.map((s, j) => (j === i ? { ...s, [field]: val } : s)));
  const moveStage = (i, dir) => setStages((ss) => {
    const j = i + dir;
    if (j < 0 || j >= ss.length) return ss;
    const n = [...ss];
    const [m] = n.splice(i, 1);
    n.splice(j, 0, m);
    return n;
  });
  const removeStage = (i) => setStages((ss) => ss.filter((_, j) => j !== i));
  const removeAgent = (i, id) => setStages((ss) => ss.map((s, j) => (j === i ? { ...s, who: s.who.filter((x) => x !== id) } : s)));
  const addStage = (i) => setStages((ss) => {
    const n = [...ss]; n.splice(i, 0, { id: 'custom-' + Date.now(), name: 'New stage', icon: 'dot', desc: 'Describe what happens here.', who: [] }); return n;
  });
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 60px', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* header */}
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
              <Icon name="check" size={14} /> {saved ? 'Saved to gallery' : 'Save as template'}</button>
          </div>
        </div>

        {/* current template + audience hint */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 22px', padding: '11px 15px',
          borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />Based on “{RT.WORKFLOW.template}”</span>
          <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>New here? This template just works. Power user? Edit any stage below.</span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--run)' }} /> running now at the table</span>
        </div>

        {/* pipeline */}
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
                onAddAgent={onAddAgent} onRemoveAgent={(id) => removeAgent(i, id)}
                onEdit={(field, val) => editStage(i, field, val)} onMove={(dir) => moveStage(i, dir)}
                canLeft={i > 0} canRight={i < stages.length - 1} />
            </React.Fragment>
          ))}
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="sparkle" size={13} /> Every task this workbench runs follows these stages — change them once, and the whole team adapts.
        </div>
      </div>
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
