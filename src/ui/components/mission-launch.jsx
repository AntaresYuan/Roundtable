'use client';

import React from 'react';
import {
  BUILTIN_WORKFLOW_TEMPLATES,
  flagshipWorkflowTemplate,
} from '@/contracts/workflow-template';

const { useState, useEffect, useRef, useCallback } = React;

/**
 * Novice Mission launch + checkpoint UX (spec 130/110/140 · #151).
 *
 * The primary user flow: say what you want → pick a recommended template →
 * give the minimum inputs → watch the Mission, with required decisions kept
 * separate from agent status. Self-contained on the /mission route so it does
 * not disturb the existing chat app. Talks to the real /api/orchestrator/turn
 * and /api/orchestrator/mission endpoints, so it creates a real Mission record.
 */
export default function MissionLaunch() {
  const [phase, setPhase] = useState('launch'); // 'launch' | 'running'
  const [templateId, setTemplateId] = useState(flagshipWorkflowTemplate().templateId);
  const [inputs, setInputs] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [explain, setExplain] = useState(true);
  const [paused, setPaused] = useState(false);
  const [mission, setMission] = useState(null);
  const [turnId, setTurnId] = useState(null);
  const chatIdRef = useRef(null);

  const template =
    BUILTIN_WORKFLOW_TEMPLATES.find((t) => t.templateId === templateId) ||
    flagshipWorkflowTemplate();
  const guideById = Object.fromEntries(template.stageGuides.map((g) => [g.stageId, g]));

  const refreshMission = useCallback(async () => {
    const chatId = chatIdRef.current;
    if (!chatId) return;
    try {
      const res = await fetch(`/api/orchestrator/mission?chatId=${encodeURIComponent(chatId)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.ok) setMission(data.mission);
    } catch {
      /* transient poll error — keep the last mission */
    }
  }, []);

  useEffect(() => {
    if (phase !== 'running' || paused) return undefined;
    refreshMission();
    const id = setInterval(refreshMission, 2500);
    return () => clearInterval(id);
  }, [phase, paused, refreshMission]);

  const setInput = (id, value) => setInputs((prev) => ({ ...prev, [id]: value }));

  const goalInput = template.requiredInputs.find((i) => i.required) || template.requiredInputs[0];
  const canStart = !!goalInput && !!(inputs[goalInput.id] || '').trim();

  async function startMission() {
    if (!canStart || submitting) return;
    setSubmitting(true);
    setError(null);
    const message = template.requiredInputs
      .map((i) => {
        const value = (inputs[i.id] || '').trim();
        if (!value) return null;
        return i.id === goalInput.id ? value : `${i.label}: ${value}`;
      })
      .filter(Boolean)
      .join('\n');
    const chatId = `local-mission-${Date.now()}`;
    chatIdRef.current = chatId;
    try {
      const res = await fetch('/api/orchestrator/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, chatId, workflowTemplateId: template.templateId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'turn_failed');
      setTurnId(data.id);
      setPhase('running');
      await refreshMission();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the mission.');
    } finally {
      setSubmitting(false);
    }
  }

  async function continueMission() {
    if (!turnId) return;
    try {
      await fetch('/api/orchestrator/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId, decision: 'approve' }),
      });
      await refreshMission();
    } catch {
      setError('Could not record your approval.');
    }
  }

  if (phase === 'launch') {
    return (
      <Shell>
        <h1 style={S.h1}>Start a mission</h1>
        <p style={S.sub}>Tell us what you want to accomplish. We&apos;ll run an expert workflow for you.</p>

        <div style={S.cards}>
          {BUILTIN_WORKFLOW_TEMPLATES.map((t) => (
            <button
              key={t.templateId}
              onClick={() => setTemplateId(t.templateId)}
              style={{ ...S.tplCard, ...(t.templateId === templateId ? S.tplCardOn : {}) }}
            >
              <div style={S.tplHead}>
                <span style={S.tplName}>{t.name}</span>
                {t.flagship && <span style={S.badge}>Recommended</span>}
              </div>
              <div style={S.tplSummary}>{t.summary}</div>
              <div style={S.tplBest}>{t.bestFor}</div>
            </button>
          ))}
        </div>

        <div style={S.form}>
          {template.requiredInputs.map((i) => (
            <label key={i.id} style={S.field}>
              <span style={S.label}>
                {i.label}
                {!i.required && <span style={S.optional}> (optional)</span>}
              </span>
              {i.help && <span style={S.help}>{i.help}</span>}
              <textarea
                rows={i.id === goalInput?.id ? 3 : 2}
                placeholder={i.placeholder || ''}
                value={inputs[i.id] || ''}
                onChange={(e) => setInput(i.id, e.target.value)}
                style={S.input}
              />
            </label>
          ))}
        </div>

        {error && <div style={S.error}>{error}</div>}
        <div style={S.actions}>
          <button onClick={startMission} disabled={!canStart || submitting} style={S.primary}>
            {submitting ? 'Starting…' : `Start ${template.name}`}
          </button>
          <span style={S.expects}>You&apos;ll get: {template.expectedOutput}</span>
        </div>
      </Shell>
    );
  }

  const stages = mission?.stages || [];
  const checkpoints = mission?.checkpoints || [];
  // Required decisions = checkpoints awaiting the user, kept separate from status.
  const decisions = checkpoints.filter((c) => c.status === 'active' || c.status === 'pending');

  return (
    <Shell>
      <div style={S.runHead}>
        <div>
          <div style={S.eyebrow}>{template.name}</div>
          <h1 style={S.h1}>{mission?.goal || 'Mission'}</h1>
        </div>
        <span style={{ ...S.status, ...statusStyle(mission?.status) }}>{mission?.status || 'loading'}</span>
      </div>

      <div style={S.controls}>
        <button onClick={() => setExplain((v) => !v)} style={S.ghost}>
          {explain ? 'Hide explanations' : 'Explain simply'}
        </button>
        <button onClick={() => setPaused((v) => !v)} style={S.ghost}>
          {paused ? 'Resume updates' : 'Pause updates'}
        </button>
        <button onClick={refreshMission} style={S.ghost}>Refresh</button>
      </div>

      <section style={S.section}>
        <h2 style={S.h2}>Needs your decision</h2>
        {decisions.length === 0 ? (
          <p style={S.muted}>Nothing needs you right now.</p>
        ) : (
          decisions.map((c) => (
            <div key={c.id} style={S.decision}>
              <div style={S.decisionTitle}>{c.label}</div>
              {c.reason && <div style={S.decisionReason}>{c.reason}</div>}
              <div style={S.decisionActions}>
                <button onClick={continueMission} style={S.primarySm}>Approve &amp; continue</button>
              </div>
            </div>
          ))
        )}
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>Progress</h2>
        {stages.length === 0 ? (
          <p style={S.muted}>Setting up the plan…</p>
        ) : (
          stages.map((s) => {
            const active = s.id === mission?.activeStageId;
            const guide = guideById[s.id];
            return (
              <div key={s.id} style={{ ...S.stage, ...(active ? S.stageOn : {}) }}>
                <span style={{ ...S.dot, ...stageDot(s.status) }} />
                <div style={S.stageBody}>
                  <div style={S.stageTop}>
                    <span style={S.stageName}>{s.name}</span>
                    <span style={S.stageStatus}>{s.status}</span>
                  </div>
                  {explain && guide && <div style={S.stageIntent}>{guide.intent}</div>}
                </div>
              </div>
            );
          })
        )}
      </section>

      {error && <div style={S.error}>{error}</div>}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={S.page}>
      <div style={S.container}>{children}</div>
    </div>
  );
}

function statusStyle(status) {
  if (status === 'blocked') return { background: 'var(--warn)', color: '#1a1a1a' };
  if (status === 'completed') return { background: 'var(--ok)', color: '#fff' };
  if (status === 'failed') return { background: 'var(--bad)', color: '#fff' };
  return { background: 'var(--surface-3)', color: 'var(--text-muted)' };
}

function stageDot(status) {
  if (status === 'done') return { background: 'var(--ok)' };
  if (status === 'active') return { background: 'var(--accent)' };
  if (status === 'blocked') return { background: 'var(--warn)' };
  if (status === 'failed') return { background: 'var(--bad)' };
  return { background: 'var(--border-strong)' };
}

const S = {
  page: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', font: 'var(--fs) var(--font-ui)' },
  container: { maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' },
  h1: { fontSize: 26, fontWeight: 600, margin: '0 0 6px' },
  h2: { fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: 'var(--text-muted)' },
  sub: { fontSize: 14.5, color: 'var(--text-muted)', margin: '0 0 24px' },
  eyebrow: { fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' },
  cards: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 28 },
  tplCard: { textAlign: 'left', cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 16, font: 'inherit', color: 'inherit', display: 'grid', gap: 6, transition: 'border-color .15s, box-shadow .15s' },
  tplCardOn: { borderColor: 'var(--accent)', boxShadow: 'var(--shadow-card)' },
  tplHead: { display: 'flex', alignItems: 'center', gap: 8 },
  tplName: { fontSize: 15, fontWeight: 600, flex: 1 },
  badge: { fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--r-chip)', padding: '2px 7px' },
  tplSummary: { fontSize: 13.5, color: 'var(--text)' },
  tplBest: { fontSize: 12.5, color: 'var(--text-faint)' },
  form: { display: 'grid', gap: 16, marginBottom: 20 },
  field: { display: 'grid', gap: 5 },
  label: { fontSize: 13.5, fontWeight: 500 },
  optional: { color: 'var(--text-faint)', fontWeight: 400 },
  help: { fontSize: 12.5, color: 'var(--text-faint)' },
  input: { font: 'inherit', fontSize: 14, padding: '10px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', resize: 'vertical' },
  actions: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  expects: { fontSize: 12.5, color: 'var(--text-faint)' },
  primary: { font: 'inherit', fontSize: 14.5, fontWeight: 600, padding: '11px 20px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' },
  primarySm: { font: 'inherit', fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' },
  error: { fontSize: 13, color: 'var(--bad)', background: 'var(--surface-2)', border: '1px solid var(--bad)', borderRadius: 'var(--r-sm)', padding: '10px 12px', margin: '16px 0' },
  runHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  status: { fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 'var(--r-chip)', textTransform: 'capitalize', whiteSpace: 'nowrap' },
  controls: { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
  ghost: { font: 'inherit', fontSize: 12.5, padding: '6px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' },
  section: { marginBottom: 28 },
  muted: { fontSize: 13.5, color: 'var(--text-faint)', margin: 0 },
  decision: { background: 'var(--surface)', border: '1px solid var(--warn)', borderLeft: '3px solid var(--warn)', borderRadius: 'var(--r-card)', padding: 14, marginBottom: 10 },
  decisionTitle: { fontSize: 14, fontWeight: 600, marginBottom: 4 },
  decisionReason: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 },
  decisionActions: { display: 'flex', gap: 8 },
  stage: { display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', background: 'var(--surface)', marginBottom: 8 },
  stageOn: { borderColor: 'var(--accent)' },
  dot: { width: 10, height: 10, borderRadius: '50%', marginTop: 5, flexShrink: 0 },
  stageBody: { flex: 1 },
  stageTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  stageName: { fontSize: 14, fontWeight: 500 },
  stageStatus: { fontSize: 11.5, color: 'var(--text-faint)', textTransform: 'capitalize' },
  stageIntent: { fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 },
};
