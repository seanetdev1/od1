import React, { useEffect, useState } from 'react';
import { Checkbox, Spin } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section } from './parts';
import { labelOf } from './designations';

// Who is told when a job is created - "New job created: TP-123/27 by Admin",
// within a minute, on screen (the user's request, 2026-11-23). Nobody until
// designations are picked here. The rules - not your own jobs, not migrated
// ones, only your companies - are the backend's functions/newJobAlerts; the
// asking is Components/Shared/NewJobAlerts.
//
// Changed here, kept by Save - as the other Configuration sections.
const NewJobAlerts = () => {
  const [designations, setDesignations] = useState([]); // all, in order
  const [saved, setSaved] = useState([]);
  const [picked, setPicked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    axiosClient.get('/settings/newJobAlerts')
      .then(({ data }) => {
        if (!alive) return;
        if (data?.status !== 'success') throw new Error(data?.result);
        setDesignations(data.designations || []);
        setSaved(data.result?.designations || []);
        setPicked(data.result?.designations || []);
      })
      .catch(() => openNotification('Error', 'Could not load the new job alerts.', 'red'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // In the server's order, so an unchanged pick compares equal.
  const ordered = (list) => designations.filter((d) => list.includes(d));
  const dirty = ordered(picked).join('|') !== ordered(saved).join('|');

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/newJobAlerts', { designations: ordered(picked) });
      if (data.status !== 'success') throw new Error(data.result);
      setSaved(data.result.designations);
      setPicked(data.result.designations);
      openNotification('Success', 'New job alerts saved.', 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title='New Job Alerts'
      hint={'Users with a ticked designation are told, within a minute, when someone else creates a job: '
        + '"New job created: TP-123/27 by Admin". Not for jobs they made themselves, migrated jobs, or jobs in '
        + 'companies they do not work in. Nobody is told until a designation is ticked.'}
    >
      {loading ? <Spin /> : (
        <>
          <Checkbox.Group
            value={picked}
            onChange={setPicked}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', maxWidth: 640 }}
            options={designations.map((d) => ({ label: labelOf(d), value: d }))}
          />
          {!picked.length && (
            <div className='grey-txt fs-12 mt-2'>Nobody is told about new jobs.</div>
          )}
          <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </>
      )}
    </Section>
  );
};

export default NewJobAlerts;
