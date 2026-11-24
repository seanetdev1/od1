import React, { useEffect, useState } from 'react';
import { Button, InputNumber, Spin } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section } from './parts';

// The days each of the bell's alert lists checks against (the user's request,
// 2026-11-23: "invoice due over 90 days are critical, I should be able to set
// it at 120 if I want, same with the others"). The server sends the fields,
// what is saved and the defaults, and refuses a set that cannot work - Invoices
// Due must be fewer days than Critical (functions/bellAlerts).
//
// Changed here, kept by Save - as the other Configuration sections.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const BellAlertDays = () => {
  const [fields, setFields] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [max, setMax] = useState(3650);
  const [saved, setSaved] = useState({});
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    axiosClient.get('/settings/bellAlertDays')
      .then(({ data }) => {
        if (!alive) return;
        if (data?.status !== 'success') throw new Error(data?.result);
        setFields(data.fields || []);
        setDefaults(data.defaults || {});
        setMax(data.max || 3650);
        setSaved(data.result || {});
        setDays(data.result || {});
      })
      .catch(() => openNotification('Error', 'Could not load the alert days.', 'red'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const dirty = !same(days, saved);
  const blank = fields.some((f) => !Number.isInteger(days[f.key]));
  const clash = Number(days.due) >= Number(days.critical);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/bellAlertDays', { days });
      if (data.status !== 'success') throw new Error(data.result);
      setSaved(data.result);
      setDays(data.result);
      openNotification('Success', 'Alert days saved.', 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title='Alert Days'
      hint={'How long each of the bell\'s alert lists allows before a record is listed. An invoice is on Invoices Due '
        + 'from its due days until its Critical days, then on Critical - so Invoices Due must be the smaller.'}
      extra={!loading && (
        <Button size='small' disabled={same(days, defaults)} onClick={() => setDays(defaults)}
          title='90 days for Critical invoices, 45 for Invoices Due, 7 for the rest. Save to keep it.'>
          Back to the defaults
        </Button>
      )}
    >
      {loading ? <Spin /> : (
        <>
          <div className='bad-rows'>
            {fields.map((f) => (
              <div key={f.key} className='bad-row'>
                <span className='bad-list'>{f.list}</span>
                <span className='bad-text'>
                  {f.label}
                  <InputNumber
                    aria-label={`${f.list}: ${f.label} … ${f.after}`}
                    min={1} max={max} precision={0} size='small'
                    value={days[f.key]}
                    onChange={(v) => setDays((d) => ({ ...d, [f.key]: v === null ? null : Math.round(v) }))}
                    style={{ width: 76, margin: '0 8px' }}
                  />
                  {f.after}
                </span>
              </div>
            ))}
          </div>
          {clash && !blank && (
            <div style={{ color: '#b02a37', fontSize: 12.5, marginTop: 8 }}>
              Invoices Due must be fewer days than Critical.
            </div>
          )}
          <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || !dirty || blank || clash}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </>
      )}
      <style jsx>{`
        .bad-rows { max-width: 640px; }
        .bad-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f3f5f7; }
        .bad-list { flex: 0 0 110px; font-size: 11px; font-weight: 600; color: #8a97a3; text-transform: uppercase; letter-spacing: 0.03em; }
        .bad-text { display: inline-flex; align-items: center; flex-wrap: wrap; font-size: 13.5px; }
      `}</style>
    </Section>
  );
};

export default BellAlertDays;
