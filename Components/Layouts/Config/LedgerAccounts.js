import React, { useEffect, useState } from 'react';
import { Select, Spin } from 'antd';
import axiosClient from 'apis/axiosClient';
import { CompanyLayerPicker, useCompanyLayer } from './CompanyLayerPicker';
import openNotification from 'Components/Shared/Notification';
import { Section, SubHead, Hint } from './parts';

// Admin: which ledger accounts an approved invoice posts to.
//
// The posting code used to find these by exact title - 'AIR FREIGHT INCOME',
// 'LCL FREIGHT EXP' - which only works on a chart of accounts using those
// words. An install that names its accounts differently got a null account and
// an invoice that could not be approved, with nothing on screen to fix.
//
// Unset rows still fall back to the old titles, so this screen is a correction
// rather than a prerequisite.
// `disbursement` is offered only where it means something. A clearing agent
// pays duty and taxes for the client and recharges them at cost; those lines
// post to a balance-sheet account instead of income or expense, so they never
// reach the P&L. Freight has no equivalent.
//
// THREE SECTIONS - freight, customs clearance, aviation - because each is its
// own line of business and its own accounts. Aviation used to share air
// freight's row; it has its own now, and while it is empty a flight posts
// wherever air freight does, exactly as before.
const FREIGHT = [
  { key: 'AIR', label: 'Air freight', hint: 'Air export / import jobs' },
  { key: 'FCL', label: 'FCL freight', hint: 'Sea jobs with sub type FCL' },
  { key: 'LCL', label: 'LCL freight', hint: 'Sea jobs with sub type LCL' },
];
const AVIATION = [
  { key: 'AVIATION', label: 'Aviation flights', hint: 'Every flight. Empty: uses Air freight\'s accounts' },
];
/* CLEARANCE BY TRANSPORT AND DIRECTION - the lines a clearing agent reports
 * on. By Road is one row whichever way the goods go.
 *
 * A row left empty posts where the job posted before these rows existed: the
 * old Clearance - import / export accounts (and, for expense, Clearance - LCL /
 * FCL by cargo type). The placeholder says which account that is, when one was
 * chosen, so an empty box never hides where the money goes. */
const CUSTOMS = [
  { key: 'CUSTOMS_SEA_IMPORT', label: 'Sea import', hint: 'Customs jobs by sea, import', disbursement: true, fallback: 'CUSTOMS_IMPORT' },
  { key: 'CUSTOMS_SEA_EXPORT', label: 'Sea export', hint: 'Customs jobs by sea, export', disbursement: true, fallback: 'CUSTOMS_EXPORT' },
  { key: 'CUSTOMS_AIR_IMPORT', label: 'Air import', hint: 'Customs jobs by air, import', disbursement: true, fallback: 'CUSTOMS_IMPORT' },
  { key: 'CUSTOMS_AIR_EXPORT', label: 'Air export', hint: 'Customs jobs by air, export', disbursement: true, fallback: 'CUSTOMS_EXPORT' },
  { key: 'CUSTOMS_ROAD', label: 'Transport', hint: 'Customs jobs by road, import and export', disbursement: true },
];

/* SALES TAX - one pair for every job type, shown whatever the mode. Approval
 * takes the tax on a taxed line off the job's income (or expense) line and
 * posts it here: SERVICES CHARGES 2,500 at 15% is 2,500 income and 375 tax.
 * Empty, the tax stays in income / expense with its charge, as before - see
 * the server's functions/invoiceTaxSplit. */
const TAX = [
  {
    key: 'TAX',
    label: 'Tax on charges',
    hint: 'Income: the tax on an invoice to a client or agent. Expense: the tax on a bill from a vendor or agent.',
  },
];
const TAX_HINT = 'Where the sales tax on a taxed charge posts when an invoice is approved. A 2,500 charge at 15% '
  + 'posts 2,500 to the job type’s account above and 375 here. Leave a side empty and its tax stays in that '
  + 'account with the charge, as now. Invoices already approved are not re-posted.';

// Only the section for the install's OPERATION MODE is shown - a clearing
// agent has no freight or aviation accounts to set, and offering the rows
// invites mapping accounts that will never be posted to. If the mode cannot
// be read, all three show rather than none.
const SECTIONS = [
  { mode: 'freight', title: 'Freight', rows: FREIGHT },
  { mode: 'customs', title: 'Customs Clearance', rows: CUSTOMS },
  { mode: 'aviation', title: 'Aviation', rows: AVIATION },
];
const DASH = <span style={{ color: '#ccc', fontSize: 12 }}>—</span>;

const LedgerAccounts = () => {
  const [accounts, setAccounts] = useState([]);
  const [mapping, setMapping] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState(null);
  // Whose mapping: '' = the install's, else one company's own - offered only
  // where the chart of accounts is kept per company, since a company with its
  // own accounts cannot post to the install's. A side a company leaves empty
  // posts where the install's mapping says.
  const [companyId, setCompanyId] = useCompanyLayer();
  const shown = SECTIONS.some((s) => s.mode === mode) ? SECTIONS.filter((s) => s.mode === mode) : SECTIONS;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = companyId ? { companyId } : {};
    (async () => {
      try {
        const [acc, cfg, op] = await Promise.all([
          // Naming the company lists ITS accounts where the chart is per company.
          axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_CHILD_ACCOUNTS, { params }),
          axiosClient.get('/settings/ledgerAccounts', { params }),
          // From the server, not the cookie: the cookie is only refreshed when
          // the main layout loads, and this decides which accounts can be set.
          axiosClient.get('/settings/operationMode').catch(() => null),
        ]);
        if (!alive) return;
        setAccounts(acc?.data?.result || []);
        setMapping(cfg?.data?.result || {});
        setMode(op?.data?.mode || null);
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

  const set = (bucket, side, value) =>
    setMapping((m) => ({ ...m, [bucket]: { ...(m[bucket] || {}), [side]: value ?? null } }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/ledgerAccounts', { mapping, ...(companyId ? { companyId } : {}) });
      if (data.status === 'success') {
        setMapping(data.result || {});
        openNotification('Success', 'Ledger accounts saved.', 'green');
      } else {
        openNotification('Error', data.result || 'Could not save.', 'red');
      }
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  // What an empty row falls back to, if that old row had an account chosen.
  const titleOf = (id) => (accounts || []).find((a) => a.id === id)?.title;
  const placeholderFor = (fallback, side) => {
    const now = fallback && titleOf(mapping?.[fallback]?.[side]);
    return now ? `Now: ${now}` : 'Match by name';
  };

  const picker = (bucket, side, fallback, placeholder) => (
    <Select
      showSearch allowClear
      style={{ width: '100%' }}
      optionFilterProp='label'
      placeholder={placeholder || placeholderFor(fallback, side)}
      value={mapping?.[bucket]?.[side] ?? undefined}
      onChange={(v) => set(bucket, side, v)}
      options={options}
      aria-label={`${bucket} ${side} account`}
    />
  );

  // One section's rows: a name, then an account per side.
  const accountTable = (rows, { withDisbursement, firstHeading, placeholder }) => (
    <table style={{ width: '100%', fontSize: 13 }}>
      <thead>
        <tr style={{ color: '#888', fontSize: 11, textTransform: 'uppercase' }}>
          <th style={{ width: withDisbursement ? '18%' : '22%', paddingBottom: 6 }}>{firstHeading}</th>
          <th style={{ width: withDisbursement ? '27%' : '39%', paddingBottom: 6 }}>Income account</th>
          <th style={{ width: withDisbursement ? '27%' : '39%', paddingBottom: 6 }}>Expense account</th>
          {withDisbursement && (
            <th style={{ width: '28%', paddingBottom: 6 }}>
              {rows.some((b) => b.disbursement) ? 'Disbursements account' : ''}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.key}>
            <td style={{ paddingBottom: 8, paddingRight: 10, verticalAlign: 'top' }}>
              <b>{b.label}</b>
              <Hint text={b.hint} />
            </td>
            <td style={{ paddingBottom: 8, paddingRight: 8 }}>
              {b.expenseOnly ? DASH : picker(b.key, 'income', b.fallback, placeholder)}
            </td>
            <td style={{ paddingBottom: 8, paddingRight: 8 }}>{picker(b.key, 'expense', b.fallback, placeholder)}</td>
            {withDisbursement && (
              <td style={{ paddingBottom: 8 }}>
                {b.disbursement ? picker(b.key, 'disbursement', b.fallback) : (rows.some((r) => r.disbursement) ? DASH : null)}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Section
      title='Ledger Accounts'
      hint='Where an approved invoice posts its income and expense. Leave a row empty to keep matching on the default account name.'
    >
      <CompanyLayerPicker value={companyId} onChange={setCompanyId}
        hint="A company's own mapping: a row it leaves empty posts where every company's does." />

      {loading ? <Spin /> : (
        <>
          {shown.map(({ title, rows }) => (
            <div key={title} data-testid={`ledger-section-${title}`} style={{ marginBottom: 18 }}>
              <SubHead style={{ marginTop: 4 }}>{title}</SubHead>
              {/* Only customs has a disbursements account; the other two
                  sections do not carry an empty column for it. */}
              {accountTable(rows, { withDisbursement: rows.some((b) => b.disbursement), firstHeading: 'Job type' })}
            </div>
          ))}

          {/* Every mode's - tax is on the charge, whatever the job. Laid out
              on the columns of the section above so the pickers line up. */}
          <div data-testid='ledger-tax' style={{ marginBottom: 18 }}>
            <SubHead style={{ marginTop: 4 }} hint={TAX_HINT}>Sales tax</SubHead>
            {accountTable(TAX, {
              withDisbursement: shown.some((s) => s.rows.some((b) => b.disbursement)),
              firstHeading: 'Tax',
              placeholder: 'Not set: stays with the charge',
            })}
          </div>

          <button onClick={save} disabled={saving} className='btn-custom' style={{ marginTop: 12 }}>
            {saving ? 'Saving…' : 'Save ledger accounts'}
          </button>
        </>
      )}
    </Section>
  );
};

export default LedgerAccounts;
