import React, { useEffect, useState } from 'react';
import { Spin, Switch, Input } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { DEFAULT_REFERENCE_LABEL, withDefaults } from 'functions/customsJobForm';
import { Section, SettingRow, SubHead } from './parts';
import CustomsJobLayout from './CustomsJobLayout';

/**
 * Admin: a customs job's screen - Configuration > Customs > Job Screen, the
 * AppSetting `customsJobForm` (functions/customsJobForm). Asked for by Essani
 * as options, not changes (the user, 2026-11-14): unset, every job screen is
 * as it was, so CargoLinkers and HO-ENT see nothing new.
 *
 * Changed here, kept by Save - as the other Configuration tabs.
 */
const SWITCHES = [
  {
    key: 'freightForwarding',
    label: 'Freight Forwarding job type',
    hint: 'Adds Freight Forwarding to a customs job\'s Job Type. A Freight Forwarding job has an HBL # where the others '
      + 'have a Client Invoice # - on the job screen and its invoices - and saves with it in place of the Client Invoice #.',
  },
  {
    key: 'commodities',
    label: 'Commodities',
    hint: 'The Commodity box in a customs job\'s Goods section. Off, it is left off the job screen; a job that has one '
      + 'keeps it.',
  },
  {
    key: 'containerSizeList',
    label: 'Container size from a list',
    hint: 'A container\'s Size is picked from the container sizes (40HC, 20SD...) rather than typed. A size already on a '
      + 'job stays as it is.',
  },
  {
    key: 'addPorts',
    label: 'Add ports from the job',
    hint: 'Port Of Loading, Port Of Discharge and Port Of Final Destination on a sea job open Setup > Ports\' form, '
      + 'and the job picks the port it adds - for whoever may add ports. One added as a Port Of Loading is ticked as '
      + 'a customs port of loading; once any port is ticked, the ticked ports are that list.',
  },
  {
    key: 'uniqueGdNumber',
    label: 'GD # on one job only',
    hint: 'A job is not saved with a GD # another job of the company already has - any client, any date; case and '
      + 'spaces ignored. Cancelled jobs do not count, and a job keeps a number it already has.',
  },
  {
    key: 'uniqueClientInvoice',
    label: 'Client Invoice # on one job only',
    hint: 'A job is not saved with a Client Invoice # another job of the company already has - any client, any date. '
      + 'Leave off where one client invoice can be split over several jobs (part shipments). Cancelled jobs do not '
      + 'count, and a job keeps a number it already has.',
  },
  {
    key: 'uniqueJobRef',
    label: 'S/R Page # on one job only',
    hint: 'A job is not saved with an S/R Page # (under the name above) another job of the company already has. '
      + 'Cancelled jobs do not count, and a job keeps a number it already has.',
  },
  {
    key: 'directJobFileFromRef',
    label: 'Direct E/R File # from the S/R Page #',
    hint: 'Choosing a job on a Direct Job E/R line fills its File # with the job\'s S/R Page # (under the name above). '
      + 'Off, it is the job\'s migrated Climax file number, as before. Lines already saved keep theirs.',
  },
];

const CustomsJobScreen = () => {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [documentsOnGd, setDocumentsOnGd] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      axiosClient.get('/settings/customsJobForm'),
      axiosClient.get('/settings/customsDocumentsOnGd').catch(() => null),
    ])
      .then(([jobForm, docs]) => {
        if (!alive) return;
        const value = withDefaults(jobForm.data?.result);
        setSaved(value);
        setForm(value);
        setDocumentsOnGd(Boolean(docs?.data?.result?.enabled));
      })
      .catch(() => openNotification('Error', 'Could not load the job screen settings.', 'red'));
    return () => { alive = false; };
  }, []);

  if (!form) return <Section title='Job Screen'><Spin /></Section>;

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const unnamedTab = (form.layout?.tabs || []).some((t) => !String(t.title || '').trim());

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/customsJobForm', form);
      if (data.status !== 'success') throw new Error(data.result);
      const value = withDefaults(data.result);
      setSaved(value);
      setForm(value);
      openNotification('Success', 'Job screen saved. Jobs open with it the next time they are opened.', 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title='Job Screen'>
      <SettingRow
        label='Name of the S/R Page #'
        hint={'What a customs job\'s S/R Page # is called - on the job screen, the job list\'s search and the invoice '
          + 'print. The number itself is unchanged; only its name. Blank is S/R Page #.'}
      >
        <Input value={form.referenceLabel} maxLength={40} style={{ width: 220 }}
          placeholder={DEFAULT_REFERENCE_LABEL} aria-label='Name of the S/R Page #'
          onChange={(e) => set('referenceLabel', e.target.value)} />
      </SettingRow>
      {SWITCHES.map((s) => {
        // The S/R Page # under whatever this install calls it.
        const ref = (form.referenceLabel || '').trim() || DEFAULT_REFERENCE_LABEL;
        const label = s.key === 'uniqueJobRef' ? `${ref} on one job only`
          : s.key === 'directJobFileFromRef' ? `Direct E/R File # from the ${ref}`
            : s.label;
        return (
          <SettingRow key={s.key} label={label} hint={s.hint}>
            <Switch checked={Boolean(form[s.key])} onChange={(v) => set(s.key, v)} aria-label={label} />
          </SettingRow>
        );
      })}

      <SubHead hint={'Which tabs a customs job has, what they are called, and which sections sit on each, in what '
        + 'order. Every section is always on some tab; a tab left empty is not shown. Charges stays the last tab.'}>
        Tabs and sections
      </SubHead>
      <CustomsJobLayout value={form.layout} documentsOnGd={documentsOnGd} onChange={(layout) => set('layout', layout)} />

      <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || !dirty || unnamedTab}
        title={unnamedTab ? 'Every tab needs a name' : undefined}>
        {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </button>
    </Section>
  );
};

export default CustomsJobScreen;
