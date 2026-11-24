import React, { useEffect, useState } from 'react';
import { Spin, Switch } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { rememberPlanning } from 'functions/customsPlanning';
import { Section, SettingRow } from './parts';

// Admin: how this customs install works. Offered on customs installs only -
// see Config/index.js.
//
// Job planning - the Program Book. On, Customs Job gets a Program Book: the
// client's shipping program kept row by row with no job numbers, and the
// confirmed rows moved to the jobs list, each then numbered. Off, the menu
// entry goes and the book is shut; nothing in it is deleted.
//
// Documents on Goods Declaration - where a customs job's Documents card sits:
// on the Goods Declaration tab, or (off) on Booking Info, its own tab.
//
// Charges in tabs - a customs job's Charges tab with Receivable, Payable and
// Summary each on a tab of their own, or (off) one under another on one page.
// One install asked for tabs; CargoLinkers did not (the user, 2026-11-11).
//
// Changed here, kept by Save - as the other Configuration tabs.
const Customs = () => {
  const [saved, setSaved] = useState(false);
  const [on, setOn] = useState(false);
  const [docsSaved, setDocsSaved] = useState(false);
  const [docsOn, setDocsOn] = useState(false);
  const [tabsSaved, setTabsSaved] = useState(false);
  const [tabsOn, setTabsOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      axiosClient.get('/settings/customsPlanning'),
      axiosClient.get('/settings/customsDocumentsOnGd'),
      axiosClient.get('/settings/customsChargeTabs'),
    ])
      .then(([planning, docs, tabs]) => {
        if (!alive) return;
        const enabled = Boolean(planning.data?.result?.enabled);
        setSaved(enabled);
        setOn(enabled);
        const onGd = Boolean(docs.data?.result?.enabled);
        setDocsSaved(onGd);
        setDocsOn(onGd);
        const tabbed = Boolean(tabs.data?.result?.enabled);
        setTabsSaved(tabbed);
        setTabsOn(tabbed);
      })
      .catch(() => openNotification('Error', 'Could not load the customs settings.', 'red'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const dirty = on !== saved || docsOn !== docsSaved || tabsOn !== tabsSaved;

  const save = async () => {
    setSaving(true);
    try {
      if (on !== saved) {
        const { data } = await axiosClient.post('/settings/customsPlanning', { enabled: on });
        if (data.status !== 'success') throw new Error(data.result);
        const enabled = Boolean(data.result?.enabled);
        setSaved(enabled);
        // The sidebar reads this - the entry appears or goes on the next page.
        rememberPlanning(enabled);
      }
      if (docsOn !== docsSaved) {
        const { data } = await axiosClient.post('/settings/customsDocumentsOnGd', { enabled: docsOn });
        if (data.status !== 'success') throw new Error(data.result);
        setDocsSaved(Boolean(data.result?.enabled));
      }
      if (tabsOn !== tabsSaved) {
        const { data } = await axiosClient.post('/settings/customsChargeTabs', { enabled: tabsOn });
        if (data.status !== 'success') throw new Error(data.result);
        setTabsSaved(Boolean(data.result?.enabled));
      }
      openNotification('Success', 'Customs settings saved.', 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title='Customs Jobs'>
      {loading ? <Spin /> : (
        <>
          <SettingRow
            label='Job planning (Program Book)'
            hint={'Adds Program Book under Customs Job: a client\'s shipping program kept row by row - '
              + 'shipper, invoice, containers, line, vessel, gate-in, cut-off - without job numbers. When a '
              + 'shipment is confirmed, tick its row and Move to Jobs: it goes on the jobs list with a job '
              + 'number, and the row shows that number from then on. Turning this off hides the book; '
              + 'nothing in it is deleted.'}
          >
            <Switch checked={on} onChange={setOn} aria-label='Job planning (Program Book)' />
          </SettingRow>
          <SettingRow
            label='Documents on Goods Declaration'
            hint={'Shows a customs job\'s Documents (Client Invoice #, Form-E, MBL, Booking #) at the top '
              + 'of the Goods Declaration tab instead of on Booking Info, which then goes. Only where the '
              + 'boxes are shown changes. Once the tabs are arranged on Job Screen, they say where it goes.'}
          >
            <Switch checked={docsOn} onChange={setDocsOn} aria-label='Documents on Goods Declaration' />
          </SettingRow>
          <SettingRow
            label='Charges in tabs'
            hint={'Puts a customs job\'s Receivable, Payable and Summary on tabs of their own within the '
              + 'Charges tab, instead of one under another on one page. Only the layout changes; jobs open '
              + 'with it the next time they are opened.'}
          >
            <Switch checked={tabsOn} onChange={setTabsOn} aria-label='Charges in tabs' />
          </SettingRow>
          <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </>
      )}
    </Section>
  );
};

export default Customs;
