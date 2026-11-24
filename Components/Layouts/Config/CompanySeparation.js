import React, { useEffect, useState } from 'react';
import { Spin, Switch } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section, SettingRow } from './parts';

// Seanet: which master tables are kept per company.
//
// Off (the default), every company shares one list - as it always was. On, a
// record can be limited to some companies from its own form ("Visible in"),
// and every list made while working in a company shows only what that company
// may see (backend functions/companySeparation.js). Records nobody has limited
// stay visible to every company, so switching a table on hides nothing by
// itself; a record created in a company once it is on starts out as that
// company's.
const HINTS = {
  coa: 'Accounts in the chart, account pickers and the reports that list accounts.',
  parties: 'Clients, vendors, agents and non-GL parties - the party pickers on every screen.',
  charges: 'The charge list and the charge pickers on jobs and invoices.',
  chargeGroups: 'Customs default charge groups.',
  commodity: 'Commodities and HS codes.',
  vessels: 'Vessels, and so their voyages.',
  employees: 'Sales, document and account reps, managers and riders in pickers - by each employee\'s Works In companies.',
};

const CompanySeparation = () => {
  const [labels, setLabels] = useState({});
  const [saved, setSaved] = useState({});
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axiosClient.get('/settings/companySeparation')
      .then(({ data }) => { setLabels(data.labels || {}); setSaved(data.result || {}); setForm(data.result || {}); })
      .catch(() => openNotification('Error', 'Could not load the per-company settings.', 'red'));
  }, []);

  const dirty = Object.keys(labels).some((k) => Boolean(form[k]) !== Boolean(saved[k]));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/companySeparation', form);
      setSaved(data.result);
      setForm(data.result);
      openNotification('Saved', 'Per-company settings saved.', 'green');
    } catch (err) {
      openNotification('Error', err?.response?.data?.result || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  if (!Object.keys(labels).length) return <Spin />;

  return (
    <Section
      title='Keep these per company'
      hint={'Switched on, a record can be limited to some companies from its form, and lists show each '
        + 'company only its own records and the shared ones. Nothing is hidden until a record is limited.'}
    >
      {Object.entries(labels).map(([key, label]) => (
        <SettingRow key={key} label={label} hint={HINTS[key]}>
          <Switch checked={Boolean(form[key])} onChange={(v) => setForm({ ...form, [key]: v })}
            aria-label={label} />
        </SettingRow>
      ))}
      <button type='button' className='btn-custom mt-3' disabled={saving || !dirty} onClick={save}>
        {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </button>
    </Section>
  );
};

export default CompanySeparation;
