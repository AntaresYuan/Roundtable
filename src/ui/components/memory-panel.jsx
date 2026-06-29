import React from 'react';
import { Icon } from './primitives';

const { useEffect, useState } = React;

const panelBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 11px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
};
const panelField = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 10px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 12.5,
  lineHeight: 1.45,
  outline: 'none',
};
const cardStyle = {
  padding: '10px 11px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
};
const iconBtn = {
  display: 'grid',
  placeItems: 'center',
  width: 28,
  height: 28,
  flexShrink: 0,
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
};
const STARTER_PREFERENCES = [
  'Prefers concise plans before implementation.',
  'Wants technical explanations grounded in the actual repo code.',
  'Likes product reasoning before implementation details.',
];

const normalizePreference = (value) =>
  value
    .trim()
    .replace(/^[\s*-]+/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/\s+/g, ' ');

const parsePreferences = (value = '') =>
  value
    .split(/\n+/)
    .map(normalizePreference)
    .filter(Boolean);

const serializePreferences = (preferences) =>
  preferences.map(normalizePreference).filter(Boolean).join('\n');

const hasPreference = (preferences, preference) => {
  const target = normalizePreference(preference).toLowerCase();
  return preferences.some((item) => normalizePreference(item).toLowerCase() === target);
};

const uniquePreferences = (preferences) => {
  const clean = [];
  for (const item of preferences.map(normalizePreference).filter(Boolean)) {
    if (!hasPreference(clean, item)) clean.push(item);
  }
  return clean;
};

const recentUserText = (messages = []) =>
  messages
    .filter((message) => message?.authorType === 'user')
    .slice(-12)
    .map((message) => message.content || '')
    .join('\n')
    .toLowerCase();

function derivePreferenceSuggestions(messages = []) {
  const text = recentUserText(messages);
  const suggestions = [];
  if (!text) return suggestions;

  if (/[^\x00-\x7F]/.test(text) && /interview|resume|pm/.test(text)) {
    suggestions.push('Prefers explanations in their working language before interview-ready wording.');
  }
  if (/repo|code|architecture|workflow|orchestrator|infra/.test(text)) {
    suggestions.push('Wants answers grounded in actual repo code and architecture.');
  }
  if (/interview|resume|pm/.test(text)) {
    suggestions.push('Likes PM interview framing with clear product and technical talking points.');
  }
  if (/too shallow|deeper|specific|read/.test(text)) {
    suggestions.push('Prefers deeper, specific explanations over high-level summaries.');
  }

  return uniquePreferences(suggestions);
}

function ScopeBadge({ children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 7px',
      borderRadius: 5, background: 'var(--surface-3)', color: 'var(--text-muted)', fontSize: 10.5,
      fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>
      {children}
    </span>
  );
}

function MemoryPanel({ memory }) {
  const profile = memory?.profile;
  const pins = memory?.pins || [];
  const derivedSuggestions = derivePreferenceSuggestions(memory?.recentMessages || []);
  const [preferences, setPreferences] = useState([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [newPreference, setNewPreference] = useState('');
  const [editingIndex, setEditingIndex] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [newPin, setNewPin] = useState('');

  useEffect(() => {
    setPreferences(parsePreferences(profile?.defaultBrief || ''));
  }, [profile]);

  if (!memory?.live) {
    return (
      <div style={{ flex: 1, padding: '16px 16px 24px' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>
          Sign in to manage user memory and project constraints.
        </div>
      </div>
    );
  }

  const savePreferences = (next) => {
    const clean = uniquePreferences(next);
    setPreferences(clean);
    memory.onSaveProfile({ defaultBrief: serializePreferences(clean) });
  };
  const addPreference = (value) => {
    const preference = normalizePreference(value);
    if (!preference || hasPreference(preferences, preference)) return;
    savePreferences([...preferences, preference]);
  };
  const addManualPreference = () => {
    addPreference(newPreference);
    setNewPreference('');
    setManualOpen(false);
  };
  const startEdit = (index) => {
    setEditingIndex(index);
    setEditDraft(preferences[index] || '');
  };
  const saveEdit = () => {
    if (editingIndex === null) return;
    const next = [...preferences];
    next[editingIndex] = editDraft;
    savePreferences(next);
    setEditingIndex(null);
    setEditDraft('');
  };
  const deletePreference = (index) => {
    savePreferences(preferences.filter((_, i) => i !== index));
  };
  const suggestionPool = derivedSuggestions.length > 0 ? derivedSuggestions : STARTER_PREFERENCES;
  const visibleSuggestions = suggestionPool.filter(
    (suggestion) =>
      !hasPreference(preferences, suggestion) &&
      !dismissedSuggestions.includes(suggestion),
  );
  const addPin = () => {
    const content = newPin.trim();
    if (!content) return;
    memory.onAddPin(content);
    setNewPin('');
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px', display: 'grid', gap: 16 }}>
      <section style={{ display: 'grid', gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScopeBadge>User</ScopeBadge>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Learned preferences</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45 }}>
          Roundtable suggests preferences from how you work. Save the ones you want future agents to remember.
          Saved preferences affect future hand-offs only.
        </div>
        <div style={{ display: 'grid', gap: 7 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)' }}>Saved preferences</div>
          {preferences.length === 0 ? (
            <div style={{ ...cardStyle, fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>
              No saved preferences yet. Suggestions are not used until you save them.
            </div>
          ) : preferences.map((preference, index) => (
            <div key={`${preference}-${index}`} style={cardStyle}>
              {editingIndex === index ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={2}
                    style={panelField} />
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button onClick={saveEdit} disabled={!editDraft.trim() || memory.profileSaving}
                      style={{ ...panelBtn, background: 'var(--accent)', color: '#fff', border: 'none' }}>
                      <Icon name="check" size={13} /> Save
                    </button>
                    <button onClick={() => setEditingIndex(null)} style={panelBtn}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>{preference}</div>
                    <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-faint)' }}>
                      Used in future hand-offs
                    </div>
                  </div>
                  <button onClick={() => startEdit(index)} title="Edit preference" style={iconBtn}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button onClick={() => deletePreference(index)} title="Delete preference"
                    disabled={memory.profileSaving} style={iconBtn}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 7 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)' }}>Suggested preferences</div>
          {visibleSuggestions.length === 0 ? (
            <div style={{ ...cardStyle, fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>
              No new suggestions right now.
            </div>
          ) : visibleSuggestions.map((suggestion) => (
            <div key={suggestion} style={cardStyle}>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 5 }}>
                {derivedSuggestions.length > 0 ? 'Suggested from recent collaboration' : 'Starter suggestion'}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>{suggestion}</div>
              <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-faint)' }}>
                Not used until saved
              </div>
              <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                <button onClick={() => addPreference(suggestion)} disabled={memory.profileSaving}
                  style={{ ...panelBtn, background: 'var(--accent)', color: '#fff', border: 'none' }}>
                  <Icon name="check" size={13} /> Save
                </button>
                <button onClick={() => { setNewPreference(suggestion); setManualOpen(true); }}
                  style={panelBtn}>
                  <Icon name="edit" size={13} /> Edit first
                </button>
                <button onClick={() => setDismissedSuggestions((items) => [...items, suggestion])}
                  style={panelBtn}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>

        {manualOpen ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <textarea value={newPreference} onChange={(e) => setNewPreference(e.target.value)} rows={2}
              placeholder="Add a preference manually." style={panelField} />
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <button onClick={addManualPreference} disabled={!newPreference.trim() || memory.profileSaving}
                style={{ ...panelBtn, background: 'var(--accent)', color: '#fff', border: 'none',
                  opacity: newPreference.trim() ? 1 : 0.55 }}>
                <Icon name="plus" size={13} /> Add preference
              </button>
              <button onClick={() => { setManualOpen(false); setNewPreference(''); }} style={panelBtn}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setManualOpen(true)} style={{ ...panelBtn, width: 'fit-content' }}>
            <Icon name="plus" size={13} /> Add preference manually
          </button>
        )}
        {memory.profileError && <span style={{ fontSize: 11.5, color: 'var(--bad)' }}>{memory.profileError}</span>}
      </section>

      <section style={{ display: 'grid', gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScopeBadge>Project</ScopeBadge>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{memory.workbench?.name || 'Current workbench'} rules</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45 }}>
          Project rules are included in every new task in this workbench. Use them for tech stack, coding conventions,
          product constraints, and do-not-do rules.
        </div>
        <div style={{ display: 'grid', gap: 7 }}>
          {pins.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>
              No project rules pinned yet.
            </div>
          ) : pins.map((pin) => (
            <div key={pin.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
              padding: '9px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)' }}>
              <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45 }}>{pin.content}</div>
              <button onClick={() => memory.onRemovePin(pin.id)} title="Remove project rule"
                disabled={memory.pinSaving} style={iconBtn}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
        <textarea value={newPin} onChange={(e) => setNewPin(e.target.value)} rows={2}
          placeholder="Add a project rule, coding convention, or do-not-do constraint." style={panelField} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={addPin} disabled={!newPin.trim() || memory.pinSaving || !memory.workbench?.id}
            style={{ ...panelBtn, cursor: newPin.trim() && !memory.pinSaving ? 'pointer' : 'default',
              opacity: newPin.trim() ? 1 : 0.55 }}>
            <Icon name="plus" size={13} /> Add constraint
          </button>
          {memory.pinError && <span style={{ fontSize: 11.5, color: 'var(--bad)' }}>{memory.pinError}</span>}
        </div>
      </section>
    </div>
  );
}

export { MemoryPanel };
