import React, { useEffect, useState } from 'react';
import { Radio, Spin, Switch } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section, SettingRow } from './parts';

// Admin: how Accounts > Direct Job E / R behaves install-wide.
//
// New entries start as - the Entry # box's starting value on a new entry,
// revenue or expense. An install that books mostly costs through Direct Job
// was switching it on every entry, and an entry left on revenue by mistake
// posts the cost as income. It can still be changed on the entry, and a saved
// entry keeps its own.
//
// One of each charge per job (asked 2026-11-17) - a charge goes on a job once
// as a Direct Job expense and once as a revenue, across every entry, and once
// on each side of the job's charge sheet. Off until turned on: some installs
// pay a second cartage or labour on the same file as a matter of course. What
// a job already holds may stay; only a new repeat is refused. See the
// backend's functions/jobChargeRepeats.
//
// Changed here, kept by Save - as the other Configuration tabs.
const TYPES = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'expense', label: 'Expense' },
];

const DirectJob = () => {
  // Expense until the install says otherwise - the server's default.
  const [saved, setSaved] = useState({ type: 'expense', unique: false });   // as the server has it
  const [type, setType] = useState('expense');     // as on screen
  const [unique, setUnique] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      axiosClient.get('/settings/directJobDefaultType'),
      axiosClient.get('/settings/uniqueJobCharges'),
    ])
      .then(([typeRes, uniqueRes]) => {
        if (!alive) return;
        const value = typeRes?.data?.result?.type || 'expense';
        const on = Boolean(uniqueRes?.data?.result?.enabled);
        setSaved({ type: value, unique: on });
        setType(value);
        setUnique(on);
      })
      .catch(() => openNotification('Error', 'Could not load the Direct Job settings.', 'red'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const dirty = type !== saved.type || unique !== saved.unique;

  const save = async () => {
    setSaving(true);
    try {
      const next = { ...saved };
      if (type !== saved.type) {
        const { data } = await axiosClient.post('/settings/directJobDefaultType', { type });
        if (data.status !== 'success') throw new Error(data.result);
        next.type = data.result?.type || type;
      }
      if (unique !== saved.unique) {
        const { data } = await axiosClient.post('/settings/uniqueJobCharges', { enabled: unique });
        if (data.status !== 'success') throw new Error(data.result);
        next.unique = Boolean(data.result?.enabled);
      }
      setSaved(next);
      openNotification('Success', 'Direct Job settings saved.', 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title='Direct Job E / R'>
      {loading ? <Spin /> : (
        <>
          <SettingRow
            label='New entries start as'
            hint='The Entry # box on a new Direct Job entry starts on this. It can still be changed on the entry, and entries already saved keep their own.'
          >
            <Radio.Group
              optionType='button'
              buttonStyle='solid'
              options={TYPES}
              value={type}
              onChange={(e) => setType(e.target.value)}
            />
          </SettingRow>
          <SettingRow
            label='One of each charge per job'
            hint={'A charge goes on a job once as a Direct Job expense and once as a revenue, counting every entry '
              + 'on that job - and once on each side (Payable, Receivable) of the job\'s charge sheet. A second one '
              + 'is refused. Repeats a job already holds may stay; only a new one is refused.'}
          >
            <Switch aria-label='One of each charge per job' checked={unique} onChange={setUnique} />
          </SettingRow>
          <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </>
      )}
    </Section>
  );
};

export default DirectJob;
