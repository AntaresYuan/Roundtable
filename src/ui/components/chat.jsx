/* ============================================================================
   Roundtable — chat.jsx
   ChatShell (rail + thread + composer) · streaming MessageGroup · ThinkingBlock ·
   WorkingChip · Composer (@mention) · ConversationRail.
   ============================================================================ */

import React from 'react';
import { RT } from '../lib/rt';
import { Icon, Spinner, Avatar, RoleTag, Md, useTypewriter, alpha } from './primitives';
import { ArtifactRenderer, iconBtn } from './cards';
const { useState, useRef, useEffect } = React;

/* ---- ThinkingBlock : collapsed shimmer, expandable ----------------------- */
function ThinkingBlock({ text, streaming }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, background: 'none', border: 'none',
        cursor: 'pointer', font: 'inherit', padding: 0, color: 'var(--text-muted)' }}>
        <Icon name="sparkle" size={13} style={{ color: 'var(--text-faint)' }} />
        {streaming
          ? <span className="rt-shimmer" style={{ fontSize: 12.5, fontStyle: 'italic' }}>thinking…</span>
          : <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>thought for a moment</span>}
        {!streaming && <Icon name={open ? 'chevdown' : 'chevron'} size={12} style={{ color: 'var(--text-faint)' }} />}
      </button>
      {open && !streaming && (
        <div style={{ marginTop: 6, padding: '9px 12px', borderRadius: 'var(--r-sm)',
          background: 'var(--surface-2)', borderLeft: '2px solid var(--border-strong)',
          fontSize: 12.5, fontStyle: 'italic', color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {text}
        </div>
      )}
    </div>
  );
}

/* ---- WorkingChip : single collapsed tool chip, never dumps JSON ---------- */
function WorkingChip({ ev, working }) {
  const [open, setOpen] = useState(false);
  const cmd = ev.input && (ev.input.cmd || JSON.stringify(ev.input));
  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 11px',
        borderRadius: 'var(--r-chip)', cursor: 'pointer', font: 'inherit', fontSize: 12.5,
        background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
        <span style={{ fontSize: 13 }}>🤖</span>
        {working
          ? <><Spinner size={13} color="var(--text-muted)" /><span>{ev.name} is working…</span></>
          : <><Icon name="check" size={13} style={{ color: 'var(--ok)' }} /><span>{ev.name} · ran <span className="mono">{cmd}</span></span></>}
        <Icon name={open ? 'chevdown' : 'chevron'} size={12} />
      </button>
      {open && (
        <div className="mono" style={{ marginTop: 6, padding: '9px 12px', borderRadius: 'var(--r-sm)',
          background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 11.5,
          color: 'var(--text-muted)' }}>
          <div><span style={{ color: 'var(--text-faint)' }}>tool</span> {ev.name}</div>
          <div><span style={{ color: 'var(--text-faint)' }}>cmd&nbsp;</span> {cmd}</div>
          <div><span style={{ color: 'var(--text-faint)' }}>id&nbsp;&nbsp;</span> {ev.id}</div>
        </div>
      )}
    </div>
  );
}

/* ---- MessageGroup : consumes an AgentEvent stream ------------------------ */
// stages: 0 thinking · 1 working · 2 text-streaming · 3 artifacts · 4 done
function MessageGroup({ beat, agents, playing, onOpenArtifact, noticesByArtifact, onAskSync, reviewsByArtifact, onApplyFix }) {
  const agent = agents[beat.agentId];
  const isPM = !!agent.pm;
  const ev = beat.events;
  const dur = beat.dur || 2500;
  const hasThink = ev.some(e => e.type === 'thinking_delta');
  const hasTool = ev.some(e => e.type === 'tool_use');
  const thinkText = ev.filter(e => e.type === 'thinking_delta').map(e => e.delta).join(' ');
  const toolEv = ev.find(e => e.type === 'tool_use');
  const fullText = ev.filter(e => e.type === 'text_delta').map(e => e.delta).join('');
  const artifactEvs = ev.filter(e => e.type === 'artifact');
  const doneEv = ev.find(e => e.type === 'done');
  const errEv = ev.find(e => e.type === 'error');

  const [stage, setStage] = useState(playing ? 0 : 4);
  useEffect(() => {
    if (!playing) { setStage(4); return; }
    setStage(0);
    const ts = [];
    let acc = 0;
    if (hasThink) acc += dur * 0.16;
    ts.push(setTimeout(() => setStage(1), acc));            // working
    if (hasTool) acc += dur * 0.20;
    ts.push(setTimeout(() => setStage(2), acc));            // text stream begins
    const textDur = Math.max(500, dur * 0.42);
    ts.push(setTimeout(() => setStage(3), acc + textDur));  // artifacts
    ts.push(setTimeout(() => setStage(4), dur));            // done
    return () => ts.forEach(clearTimeout);
  }, [playing, beat.id, dur]);

  const shownText = useTypewriter(fullText, playing && stage === 2, Math.max(500, dur * 0.42));
  const textToShow = stage >= 3 ? fullText : (stage === 2 ? shownText : '');

  /* ---- PM = quiet narration (no bubble, muted) ---- */
  if (isPM) {
    return (
      <div className="rt-rise" style={{ display: 'flex', gap: 11, padding: '2px 0', alignItems: 'flex-start' }}>
        <div style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', fontSize: 15,
          opacity: .85, flexShrink: 0 }}>{agent.avatar}</div>
        <div style={{ flex: 1, paddingTop: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--pm)' }}>{agent.displayName}</span>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase',
              color: 'var(--text-faint)' }}>orchestrator</span>
          </div>
          {hasThink && stage < 2 && <ThinkingBlock text={thinkText} streaming={stage < 2 && playing} />}
          <div style={{ color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.55 }}>
            <span className={playing && stage === 2 ? 'rt-caret' : ''}>{textToShow}</span>
          </div>
        </div>
      </div>
    );
  }

  /* ---- regular agent group: 1px colored left border ---- */
  const streamingText = playing && stage === 2;
  return (
    <div className="rt-rise" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <Avatar agent={agent} size={32} />
      <div style={{ flex: 1, minWidth: 0,
        borderLeft: `1.5px solid ${alpha(agent.color, 55)}`, paddingLeft: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{agent.displayName}</span>
          <RoleTag agent={agent} />
          {stage >= 4 && doneEv && (
            <span className="mono tnum" style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto' }}>
              {doneEv.usage ? `${doneEv.usage.outputTokens} tok` : ''}
            </span>
          )}
          {stage < 4 && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 11.5, color: agent.color }}><Spinner size={12} color={agent.color} /> streaming</span>}
        </div>

        {hasThink && (stage < 2 || true) && stage < 2
          ? <ThinkingBlock text={thinkText} streaming={playing && stage < 2} />
          : (hasThink && <ThinkingBlock text={thinkText} streaming={false} />)}

        {hasTool && stage >= 1 && <WorkingChip ev={toolEv} working={stage < 3} />}

        {textToShow && (
          <div style={{ marginBottom: artifactEvs.length ? 12 : 0 }}>
            <Md text={textToShow} />
            {streamingText && <span className="rt-caret" />}
          </div>
        )}

        {stage >= 3 && artifactEvs.map((e, i) => {
          const art = RT.ARTIFACTS[e.artifactId];
          const notice = art && noticesByArtifact ? noticesByArtifact.get(art.id) : null;
          const reviews = art && reviewsByArtifact ? reviewsByArtifact.get(art.id) : null;
          return art ? <div key={i} style={{ marginTop: i ? 12 : 0 }}>
            <ArtifactRenderer
              art={art}
              agents={agents}
              onOpen={onOpenArtifact}
              notice={notice}
              onAskSync={onAskSync}
              reviewComments={reviews}
              onApplyFix={onApplyFix}
            />
          </div> : null;
        })}

        {errEv && <div style={{ marginTop: 8, padding: '9px 12px', borderRadius: 'var(--r-sm)',
          background: alpha('var(--bad)', 12), color: 'var(--bad)', fontSize: 13,
          borderLeft: '2px solid var(--bad)' }}>{errEv.message}</div>}
      </div>
    </div>
  );
}

/* ---- Composer with @mention ---------------------------------------------- */
function Composer({ agents, onSend }) {
  const [val, setVal] = useState('');
  const [menu, setMenu] = useState(false);
  const [sent, setSent] = useState(false);
  const taRef = useRef(null);
  const mentionable = Object.values(agents);

  const onChange = (e) => {
    const v = e.target.value; setVal(v);
    setMenu(/@(\w*)$/.test(v));
  };
  const pick = (a) => {
    setVal(v => v.replace(/@(\w*)$/, `@${a.role} `));
    setMenu(false); taRef.current && taRef.current.focus();
  };
  const send = () => {
    if (!val.trim()) return;
    onSend && onSend(val.trim()); setVal(''); setMenu(false);
    setSent(true); setTimeout(() => setSent(false), 2200);
  };
  return (
    <div style={{ position: 'relative', padding: '14px 22px 18px' }}>
      {menu && (
        <div className="rt-rise" style={{ position: 'absolute', bottom: 'calc(100% - 4px)', left: 22, width: 290,
          background: 'var(--surface)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-pop)', overflow: 'hidden', zIndex: 20 }}>
          <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-faint)', borderBottom: '1px solid var(--border)' }}>
            Mention an agent</div>
          {mentionable.map(a => (
            <button key={a.agentId} onClick={() => pick(a)} style={{ width: '100%', display: 'flex',
              alignItems: 'center', gap: 10, padding: '9px 12px', background: 'none', border: 'none',
              cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              <Avatar agent={a} size={26} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{a.displayName}</div>
                <div className="mono" style={{ fontSize: 11, color: a.color }}>@{a.role}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, padding: '10px 12px',
        borderRadius: 'var(--r-card)', border: '1px solid var(--border)', background: 'var(--surface)',
        boxShadow: 'var(--shadow-card)' }}>
        <button title="Mention (@)" onClick={() => { setVal(v => v + '@'); setMenu(true); taRef.current && taRef.current.focus(); }}
          style={{ ...iconBtn, border: 'none', background: 'var(--surface-2)' }}><Icon name="at" size={16} /></button>
        <textarea id="roundtable-composer" name="message" ref={taRef} value={val} onChange={onChange} rows={1}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Message the table…  use @ to bring in an agent"
          style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
            font: 'inherit', fontSize: 14, color: 'var(--text)', lineHeight: 1.5, maxHeight: 120, padding: '6px 0' }} />
        <button aria-label="Send message" onClick={send} disabled={!val.trim()} style={{ display: 'grid', placeItems: 'center',
          width: 36, height: 36, borderRadius: 'var(--r-sm)', border: 'none', cursor: val.trim() ? 'pointer' : 'default',
          background: val.trim() ? 'var(--accent)' : 'var(--surface-3)',
          color: val.trim() ? '#fff' : 'var(--text-faint)', transition: 'all .15s ease' }}>
          <Icon name="send" size={17} /></button>
      </div>
      <div style={{ height: 16, marginTop: 6, fontSize: 11.5, color: 'var(--text-faint)', textAlign: 'center' }}>
        {sent ? 'Sent.' : ''}
      </div>
    </div>
  );
}

/* ---- ConversationRail ----------------------------------------------------- */
/* ---- LogoMark : the rounded 3D table, as the brand mark ------------------ */
function LogoMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      {[[20, 8], [9, 13], [31, 13], [13, 24], [27, 24]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.4" fill="var(--accent)" opacity={i === 0 ? 1 : 0.55} />
      ))}
      <ellipse cx="20" cy="25" rx="13.5" ry="6.2" fill="color-mix(in oklab, var(--accent) 70%, #000 30%)" />
      <ellipse cx="20" cy="22.5" rx="13.5" ry="6.2" fill="var(--accent)" />
      <ellipse cx="17" cy="20.8" rx="8" ry="3" fill="#fff" opacity=".35" />
    </svg>
  );
}

function ConversationRail({ workbench, workbenches, tasks, agents, activeId, onPick, memberIds, onRemoveMember, onAddMember, onNewTask, onNewWorkbench, onPickWorkbench, onCollapse }) {
  const dot = { live: 'var(--run)', done: 'var(--ok)', queued: 'var(--warn)', idle: 'var(--text-faint)' };
  const [wbMenu, setWbMenu] = useState(false);
  const members = (memberIds || workbench?.members || []).map((id) => agents[id]).filter(Boolean);
  const taskMeta = (meta) => {
    if (!meta) return '';
    if (String(meta).trim().startsWith('[') || String(meta).length > 96) return 'Needs attention · details in chat';
    return meta;
  };
  return (
    <div style={{ width: 256, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 9 }}>
        <LogoMark size={26} />
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-.01em', flex: 1 }}>Roundtable</span>
        {onCollapse && <button onClick={onCollapse} title="Hide sidebar" style={{ display: 'grid', placeItems: 'center',
          width: 28, height: 28, borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface)',
          color: 'var(--text-muted)', cursor: 'pointer' }}><Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} /></button>}
      </div>

      {/* workbench switcher */}
      <div style={{ padding: '0 12px 10px', position: 'relative' }}>
        <button onClick={() => setWbMenu((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
          borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface-2)',
          color: 'var(--text)', font: 'inherit', cursor: 'pointer' }}>
          <LogoMark size={18} />
          <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workbench?.name}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>workbench · {members.length} members</div>
          </div>
          <Icon name="chevdown" size={14} style={{ color: 'var(--text-faint)' }} />
        </button>
        {wbMenu && (
          <div className="rt-zoom" style={{ position: 'absolute', top: '100%', left: 12, right: 12, zIndex: 40, marginTop: 4,
            background: 'var(--surface)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}>
            {(workbenches || []).map((w) => (
              <button key={w.id} onClick={() => { setWbMenu(false); onPickWorkbench && onPickWorkbench(w.id); }} style={{ width: '100%', display: 'flex',
                alignItems: 'center', gap: 9, padding: '9px 12px', border: 'none', background: w.id === workbench?.id ? 'var(--surface-2)' : 'transparent',
                color: 'var(--text)', font: 'inherit', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
                <LogoMark size={16} /><span style={{ flex: 1 }}>{w.name}</span>
                {w.id === workbench?.id && <Icon name="check" size={13} style={{ color: 'var(--accent)' }} />}
              </button>
            ))}
            <button onClick={() => { setWbMenu(false); onNewWorkbench && onNewWorkbench(); }} style={{ width: '100%', display: 'flex',
              alignItems: 'center', gap: 9, padding: '10px 12px', border: 'none', borderTop: '1px solid var(--border)', background: 'transparent',
              color: 'var(--accent)', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
              <Icon name="plus" size={15} /> New workbench
            </button>
          </div>
        )}
      </div>

      {/* fixed members */}
      <div style={{ padding: '0 16px 6px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Members</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>hover to remove</span>
      </div>
      <div style={{ padding: '0 14px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {members.map((a) => (
          <span key={a.agentId} className="rt-member" title={`${a.displayName} · ${a.pm ? 'facilitator' : '@' + a.role}`}
            style={{ position: 'relative' }}>
            <Avatar agent={a} size={30} />
            {!a.pm && onRemoveMember && (
              <button onClick={() => onRemoveMember(a.agentId)} title={`Remove ${a.displayName}`} style={{ position: 'absolute', top: -4, right: -4,
                width: 16, height: 16, borderRadius: '50%', border: 'none', background: 'var(--bad)', color: '#fff', cursor: 'pointer',
                display: 'none', placeItems: 'center', padding: 0 }} className="rt-member-x"><Icon name="x" size={10} /></button>
            )}
          </span>
        ))}
        <button onClick={onAddMember} title="Add member" style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center',
          border: '1.5px dashed var(--border-strong)', color: 'var(--text-faint)', cursor: 'pointer', background: 'transparent' }}>
          <Icon name="plus" size={14} /></button>
      </div>

      <div style={{ padding: '4px 12px 10px' }}>
        <button onClick={onNewTask} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '9px 12px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--accent)',
          color: '#fff', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <Icon name="plus" size={15} /> New task
        </button>
      </div>

      <div style={{ padding: '2px 16px 6px', fontSize: 10, fontWeight: 600, letterSpacing: '.09em',
        textTransform: 'uppercase', color: 'var(--text-faint)' }}>Tasks on this workbench</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        {(tasks || []).map((c) => {
          const active = c.id === activeId;
          return (
            <button key={c.id} onClick={() => onPick && onPick(c.id)} style={{ width: '100%', textAlign: 'left',
              display: 'flex', gap: 10, padding: '10px 11px', marginBottom: 2, borderRadius: 'var(--r-sm)',
              border: 'none', cursor: 'pointer', font: 'inherit',
              background: active ? 'var(--surface-3)' : 'transparent', color: 'var(--text)',
              boxShadow: active ? `inset 2px 0 0 var(--accent)` : 'none' }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 6, flexShrink: 0,
                background: dot[c.status] || 'var(--text-faint)',
                boxShadow: c.status === 'live' ? `0 0 0 3px ${alpha('var(--run)', 22)}` : 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                <div title={c.meta} style={{ fontSize: 11.5, color: 'var(--text-faint)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{taskMeta(c.meta)}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex',
        alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-3)',
          display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>U</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>You</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Building, not coding</div>
        </div>
        <Icon name="search" size={15} style={{ color: 'var(--text-faint)' }} />
      </div>
    </div>
  );
}

export { MessageGroup, ThinkingBlock, WorkingChip, Composer, ConversationRail, LogoMark };
