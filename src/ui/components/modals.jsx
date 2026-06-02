/* ============================================================================
   Roundtable — modals.jsx
   The product flows that make the workflow real: create a Task, create a
   Workbench from a workflow template (or build your own), add/manage agents.
   These embody the pitch: packaged + customizable agent workflows.
   ============================================================================ */
import React from 'react';
import { RT } from '../lib/rt';
import { Icon, Avatar, tint, alpha } from './primitives';
const { useState: useStateM } = React;
const iconBtn = { display: 'grid', placeItems: 'center', width: 30, height: 30, flexShrink: 0, borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' };

/* ---- shared modal shell -------------------------------------------------- */
function Modal({ title, sub, icon, onClose, children, footer, width = 540 }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 120, background: alpha('#000', 38),
      backdropFilter: 'blur(3px)', overflowY: 'auto' }}>
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
        <div onClick={(e) => e.stopPropagation()} className="rt-zoom" style={{ width: `min(${width}px, 100%)`,
          transformOrigin: 'center', background: 'var(--surface)', borderRadius: 'var(--r-card)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
            {icon && <span style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 9,
              background: tint('var(--accent)', 14), color: 'var(--accent)' }}><Icon name={icon} size={17} /></span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
              {sub && <div style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>{sub}</div>}
            </div>
            <button onClick={onClose} style={iconBtn}><Icon name="x" size={16} /></button>
          </div>
          <div style={{ padding: 18 }}>{children}</div>
          {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '13px 18px',
            borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>{footer}</div>}
        </div>
      </div>
    </div>
  );
}
function Btn({ children, primary, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '9px 16px', borderRadius: 'var(--r-sm)', font: 'inherit', fontSize: 13, fontWeight: 600,
      cursor: disabled ? 'default' : 'pointer', border: primary ? 'none' : '1px solid var(--border)',
      background: primary ? (disabled ? 'var(--surface-3)' : 'var(--accent)') : 'var(--surface)',
      color: primary ? (disabled ? 'var(--text-faint)' : '#fff') : 'var(--text)', transition: 'all .15s' }}>{children}</button>
  );
}
const fieldStyle = { width: '100%', padding: '10px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
  background: 'var(--surface-2)', color: 'var(--text)', font: 'inherit', fontSize: 13.5, outline: 'none' };

/* ---- the workflow pipeline (a packaged, customizable process) ------------ */
function Pipeline({ steps, editable }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 'var(--r-chip)',
            background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12, fontWeight: 500 }}>
            <Icon name={s.icon} size={13} style={{ color: 'var(--accent)' }} />{s.label}
          </div>
          {i < steps.length - 1 && <Icon name="chevron" size={13} style={{ color: 'var(--text-faint)', margin: '0 4px' }} />}
        </React.Fragment>
      ))}
      {editable && <button style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px',
        borderRadius: 'var(--r-chip)', border: '1px dashed var(--border-strong)', background: 'transparent',
        color: 'var(--text-faint)', font: 'inherit', fontSize: 12, cursor: 'pointer' }}><Icon name="plus" size={12} /> step</button>}
    </div>
  );
}

// Gallery cards are PROJECTIONS of the real BUILTIN_WORKFLOWS / user workflows
// (ADR-009 — one model, no stored second shape). See rt.js workflowToGalleryCard.

/* ---- New Workbench (workflow template gallery + custom) ------------------ */
function NewWorkbenchModal({ agents, onClose, onCreate }) {
  const [sel, setSel] = useStateM('wf-fullstack');
  const [name, setName] = useStateM('');
  const allTemplates = RT.BUILTIN_WORKFLOWS.concat(RT.workflows || []).map(RT.workflowToGalleryCard);
  const tpl = allTemplates.find((t) => t.id === sel);
  const roleColors = RT.ROLE_COLORS;
  return (
    <Modal title="New workbench" sub="A workbench is a fixed team + a workflow. Pick a proven one or build your own." icon="layers"
      onClose={onClose} width={680}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={!name.trim()} onClick={() => onCreate({ name, workflowId: tpl.id })}>Create workbench</Btn></>}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Name</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mobile Squad" style={fieldStyle} autoFocus />
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 9 }}>Start from a workflow</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
        {allTemplates.map((t) => {
          const active = sel === t.id;
          return (
            <button key={t.id} onClick={() => setSel(t.id)} style={{ textAlign: 'left', padding: '13px 14px', cursor: 'pointer',
              borderRadius: 'var(--r-card)', font: 'inherit', background: active ? tint('var(--accent)', 8) : 'var(--surface-2)',
              border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{t.name}</span>
                {t.tag && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
                  background: tint('var(--accent)', 16), color: 'var(--accent)' }}>{t.tag}</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 9 }}>{t.desc}</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {t.roles.length ? t.roles.map((r, i) => (
                  <span key={i} title={'@' + r} style={{ width: 22, height: 22, borderRadius: '50%', background: tint(roleColors[r], 22),
                    boxShadow: `0 0 0 1.5px ${alpha(roleColors[r], 55)} inset`, display: 'grid', placeItems: 'center',
                    fontSize: 9, fontWeight: 700, color: roleColors[r], fontFamily: 'var(--font-mono)' }}>{r[0].toUpperCase()}</span>
                )) : <span style={{ fontSize: 11.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>empty — you choose</span>}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ padding: '14px 16px', borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>Workflow</span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>· runs automatically, fully customizable</span>
        </div>
        <Pipeline steps={tpl.pipe} editable={tpl.custom} />
      </div>
    </Modal>
  );
}

/* ---- New Task ------------------------------------------------------------ */
function NewTaskModal({ workbench, members, agents, onClose, onCreate }) {
  const [goal, setGoal] = useStateM('');
  const examples = ['A pricing page with monthly/annual toggle', 'A REST endpoint for CSV export', 'Dark mode across the app'];
  return (
    <Modal title="New task" sub={`${workbench?.name} will pick it up and run its workflow`} icon="plus" onClose={onClose} width={560}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={!goal.trim()} onClick={() => onCreate(goal)}>Start task</Btn></>}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>What should the team build?</div>
      <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} autoFocus
        placeholder="Describe the outcome in plain language — the facilitator will plan it." style={{ ...fieldStyle, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
        {examples.map((ex) => (
          <button key={ex} onClick={() => setGoal(ex)} style={{ padding: '5px 10px', borderRadius: 'var(--r-chip)', cursor: 'pointer',
            border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', fontSize: 11.5 }}>{ex}</button>
        ))}
      </div>
      <div style={{ marginTop: 18, padding: '12px 14px', borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 9 }}>Members on the job</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(members || []).map((id) => agents[id] && (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px 4px 4px',
              borderRadius: 'var(--r-chip)', background: 'var(--surface)', border: `1px solid ${alpha(agents[id].color, 35)}` }}>
              <Avatar agent={agents[id]} size={20} ring={false} /><span style={{ fontSize: 12 }}>{agents[id].displayName}</span>
            </span>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ---- Add agent ----------------------------------------------------------- */
const ROLE_INFO = {
  architect: 'Shapes the approach and structure', planner: 'Breaks goals into tasks',
  implementer: 'Writes the code and builds', reviewer: 'Checks quality and correctness', fixer: 'Resolves failures and bugs',
};
const NAME_POOL = { architect: 'Nova', planner: 'Piper', implementer: 'Quill', reviewer: 'Vesper', fixer: 'Mendez' };
function AddAgentModal({ onClose, onAdd }) {
  const roleColors = RT.ROLE_COLORS;
  const [role, setRole] = useStateM('implementer');
  const [name, setName] = useStateM('Quill');
  return (
    <Modal title="Add an agent" sub="Compose the team for this workbench" icon="plus" onClose={onClose} width={500}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={!name.trim()} onClick={() => onAdd({ role, name: name.trim(), color: roleColors[role] })}>Add to workbench</Btn></>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 18, padding: '14px', borderRadius: 'var(--r-card)',
        background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          background: `radial-gradient(circle at 36% 30%, color-mix(in oklab, ${roleColors[role]} 30%, #fff), color-mix(in oklab, ${roleColors[role]} 58%, #000 8%))`,
          boxShadow: `inset 0 -4px 8px rgba(0,0,0,.18), 0 3px 8px -3px rgba(0,0,0,.4)` }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{name || 'New agent'}</div>
          <div className="mono" style={{ fontSize: 12, color: roleColors[role] }}>@{role}</div>
        </div>
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 7 }}>Role</div>
      <div style={{ display: 'grid', gap: 7, marginBottom: 16 }}>
        {Object.keys(ROLE_INFO).map((r) => (
          <button key={r} onClick={() => { setRole(r); setName(NAME_POOL[r]); }} style={{ display: 'flex', alignItems: 'center', gap: 11,
            padding: '10px 12px', borderRadius: 'var(--r-sm)', cursor: 'pointer', font: 'inherit', textAlign: 'left',
            background: role === r ? tint(roleColors[r], 8) : 'var(--surface-2)', border: `1.5px solid ${role === r ? roleColors[r] : 'var(--border)'}` }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: roleColors[r], flexShrink: 0 }} />
            <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: roleColors[r], minWidth: 92 }}>@{r}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ROLE_INFO[r]}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Name</div>
      <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
    </Modal>
  );
}

export { Modal, Btn, Pipeline, NewWorkbenchModal, NewTaskModal, AddAgentModal };
