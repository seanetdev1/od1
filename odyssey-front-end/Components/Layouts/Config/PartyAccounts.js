import React, { useEffect, useState } from 'react';
import { Select, Spin } from 'antd';
import axiosClient from 'apis/axiosClient';
import { CompanyLayerPicker, useCompanyLayer } from './CompanyLayerPicker';
import openNotification from 'Components/Shared/Notification';
import { Section, Hint } from './parts';

// Admin: where a new Customer's and a new Vendor's ledger account is created.
//
// Setup > Parties offers a button per kind of party - Non-GL, Customer (AR),
// Vendor (AP) - and the first two have to know which group account to hang the
// new ledger under. That cannot be found by TITLE: one install calls it
// 'ACCOUNT RECEIVABLE', another 'Accounts Receivable', another imported a
// chart of accounts that names it something else entirely. A button that
// silently picked the wrong parent would be worse than no button at all.
//
// LEAVING THESE EMPTY IS FINE. The buttons then open the ordinary party form
// with the Parent Account selector unfilled - exactly what the single Create
// button did before - so this screen is a convenience, not a prerequisite.
const SIDES = [
  {
    key: 'receivable',
    label: 'Customer (AR)',
    hint: 'The group account a new customer’s ledger is created under',
  },
  {
    key: 'payable',
    label: 'Vendor (AP)',
    hint: 'The group account a new vendor’s ledger is created under',
  },
];

const PartyAccounts = () => {
  const [accounts, setAccounts] = useState([]);
  const [mapping, setMapping] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // '' = the install's parents, else one company's own (see LedgerAccounts).
  const [companyId, setCompanyId] = useCompanyLayer();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = companyId ? { companyId } : {};
    (async () => {
      try {
        const [acc, cfg] = await Promise.all([
          // The SAME list the party form's Parent Account selector offers -
          // assets and liabilities, group accounts only. Picking from a
          // different list here than the form uses is how a configured parent
          // ends up being one the form cannot show.
          axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ACCOUNTS_FOR_PARTY_SETUP,
            { headers: { id: '1' }, params }),
          // raw: this layer as stored, not merged with the install's - the
          // Parties screen is the one that wants it merged.
          axiosClient.get('/settings/partyAccounts', { params: { ...params, raw: 1 } }),
        ]);
        if (!alive) return;
        setAccounts(acc?.data?.result || []);
        setMapping(cfg?.data?.result || {});
      } catch (e) {
        openNotification('Error', 'Could not load the chart of accounts.', 'red');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [companyId]);

  const options = React.useMemo(
    () => (accounts || []).map((a) => ({
      value: a.id,
      label: a.code ? `${a.title} (${a.code})` : a.title,
    })),
    [accounts]
  );

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/partyAccounts', { mapping, ...(companyId ? { companyId } : {}) });
      if (data.status === 'success') {
        setMapping(data.result || {});
        openNotification('Success', 'Party accounts saved.', 'green');
      } else {
        openNotification('Error', data.result || 'Could not save.', 'red');
      }
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title='Party Accounts'
      hint={'Which group account the Customer and Vendor buttons on Setup > Parties create a new ledger '
        + 'under. Leave a row empty and that button still works - it just opens the form with Parent '
        + 'Account for the user to pick.'}
    >
      <CompanyLayerPicker value={companyId} onChange={setCompanyId}
        hint="A company's own parents: one it leaves empty uses every company's." />

      {loading ? <Spin /> : (
        <>
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#888', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ width: '30%', paddingBottom: 6 }}>Button</th>
                <th style={{ width: '70%', paddingBottom: 6 }}>Parent account</th>
              </tr>
            </thead>
            <tbody>
              {SIDES.map((s) => (
                <tr key={s.key}>
                  <td style={{ paddingBottom: 8, paddingRight: 10, verticalAlign: 'top' }}>
                    <b>{s.label}</b>
                    <Hint text={s.hint} />
                  </td>
                  <td style={{ paddingBottom: 8 }}>
                    <Select
                      showSearch allowClear
                      style={{ width: '100%' }}
                      optionFilterProp='label'
                      placeholder='Leave empty to pick per party'
                      value={mapping?.[s.key] ?? undefined}
                      onChange={(v) => setMapping((m) => ({ ...m, [s.key]: v ?? null }))}
                      options={options}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </Section>
  );
};

export default PartyAccounts;
