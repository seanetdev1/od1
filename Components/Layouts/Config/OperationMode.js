import React, { useEffect, useState } from 'react';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section, Hint } from './parts';

// Admin: choose the installation's operation mode ONCE. It's a permanent,
// installation-wide setting — the backend refuses to change it after it's set,
// and this UI locks accordingly. Switching to Customs Clearance rebrands the
// app's terminology (see functions/terminology.js).
const OPTIONS = [
  { value: 'freight', label: 'Shipping & Air Freight', hint: 'Default. Sea Jobs / Air Jobs terminology.' },
  { value: 'customs', label: 'Customs Clearance', hint: 'Rebrands the app for a customs-clearance operation.' },
  { value: 'aviation', label: 'Aviation', hint: 'Airline running its own aircraft. Air Jobs only — the sea sections are hidden.' },
];

const OperationMode = () => {
  const [mode, setMode] = useState('freight');
  const [locked, setLocked] = useState(true); // assume locked until we know
  const [choice, setChoice] = useState('freight');
  const [saving, setSaving] = useState(false);

  const load = () => {
    axiosClient.get('/settings/operationMode')
      .then(({ data }) => { setMode(data.mode); setLocked(data.locked); setChoice(data.mode); })
      .catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const labelFor = (v) => (OPTIONS.find(o => o.value === v)?.label) || v;

  const save = async () => {
    const ok = window.confirm(
      `Set this installation's mode to "${labelFor(choice)}"?\n\n` +
      `This is PERMANENT and cannot be changed later.`
    );
    if (!ok) return;
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/operationMode', { mode: choice });
      if (data.status === 'success') {
        openNotification('Success', `Operation mode set to ${labelFor(data.mode)}. Reload to apply.`, 'green');
        setMode(data.mode);
        setLocked(true);
      } else {
        openNotification('Error', data.result || 'Could not set mode.', 'red');
      }
    } catch (err) {
      openNotification('Error', err?.response?.data?.result || 'Could not set mode.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title='Operation Mode'
      hint='What kind of business this installation runs. It sets the app’s terminology and which job screens are shown, and is set once.'
    >
      {locked ? (
        <p style={{ fontSize: 14, margin: 0 }}>
          This installation operates in <b>{labelFor(mode)}</b> mode.
          <Hint text={`${OPTIONS.find((o) => o.value === mode)?.hint || ''} This is a one-time setting and cannot be changed.`} />
          <span style={{ marginLeft: 10, color: '#888', fontSize: 12 }}>🔒 Locked</span>
        </p>
      ) : (
        <>
          <p style={{ fontSize: 14, marginBottom: 12 }}>
            Choose how this installation operates.{' '}
            <b style={{ color: '#b02a37' }}>This is permanent — it cannot be changed once set.</b>
          </p>
          {OPTIONS.map(o => (
            <label key={o.value} style={{ display: 'block', margin: '8px 0', cursor: 'pointer' }}>
              <input
                type="radio"
                name="opmode"
                checked={choice === o.value}
                onChange={() => setChoice(o.value)}
                style={{ marginRight: 8 }}
              />
              <b>{o.label}</b>
              <Hint text={o.hint} />
            </label>
          ))}
          <button onClick={save} disabled={saving} className="btn-custom" style={{ marginTop: 12 }}>
            {saving ? 'Saving…' : 'Set mode (one-time)'}
          </button>
        </>
      )}
    </Section>
  );
};

export default OperationMode;
