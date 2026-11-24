import React, { useEffect, useMemo, useState } from 'react';
import { Checkbox, Select, Spin, Switch } from 'antd';
import { useSelector } from 'react-redux';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { getMode } from 'functions/terminology';
import {
  JOB_BALANCING_GRID, jobBalancingColumns, defaultColumnIds, pickerOrder,
} from 'functions/jobBalancingColumns';
import { VAT_DETAIL, VAT_COLUMNS, vatDefaultColumns, vatPickerOrder } from 'functions/vatDetailColumns';
import {
  CUSTOMS_JOB_LIST, customsJobListColumns, customsJobListDefaults, customsJobListOrder,
} from 'functions/customsJobListColumns';
import { useCustomsJobForm } from 'functions/customsJobForm';
import { Section, SettingRow } from './parts';
import {
  FROM_CHOICES, TO_CHOICES, DEFAULT_REPORT_DATES, normalizeReportDates, rememberReportDates, reportDateRange,
  currentFiscalYear,
} from 'functions/reportDates';

// Admin: Configuration > Reports - where report dates start (ReportDatesCard),
// Job Balancing's advances (JobBalancingAdvancesCard), and the columns each
// report opens with, and their order.
//
// Users still add and take off columns on the report for themselves - this is
// where the report starts, and what its Default button goes back to. Built-in
// clears the setting: the report's own set again.

/**
 * One report's card.
 *
 * @param report      the setting's name - /settings/reportColumns/<report>
 * @param available   the report's columns: [{ id, heading }]
 * @param defaultsFor (configured) => the ids the report opens with
 * @param orderFor    (defaults) => every id, in the order to list them - the
 *                    report's own rule (default: the defaults first)
 * @param builtInHint what Built-in goes back to, for its tooltip
 */
export const ReportColumnsCard = ({ report, title, description, available, defaultsFor, orderFor, builtInHint }) => {
  const [order, setOrder] = useState([]);
  const [ticked, setTicked] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const show = (configured) => {
    const defaults = defaultsFor(configured);
    setOrder(orderFor ? orderFor(defaults) : pickerOrder(available, defaults));
    setTicked(new Set(defaults));
  };

  useEffect(() => {
    let alive = true;
    axiosClient.get(`/settings/reportColumns/${report}`)
      .then(({ data }) => { if (alive) show(data?.result || null); })
      .catch(() => { if (alive) { show(null); openNotification('Error', 'Could not load the saved columns.', 'red'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (i, by) => setOrder((o) => {
    const j = i + by;
    if (j < 0 || j >= o.length) return o;
    const next = [...o];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const toggle = (id) => setTicked((t) => {
    const next = new Set(t);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async (columns) => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post(`/settings/reportColumns/${report}`, { columns });
      if (data.status === 'success') {
        show(data.result);
        openNotification('Success', columns.length ? 'Report columns saved.' : 'Back to the built-in columns.', 'green');
      } else {
        openNotification('Error', data.result || 'Could not save.', 'red');
      }
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  const chosen = order.filter((id) => ticked.has(id));
  const headingOf = (id) => available.find((c) => c.id === id)?.heading || id;

  return (
    <Section title={title} hint={description} aria-label={title} data-report={report}>

      {loading ? <Spin /> : (
        <>
          <div style={{ maxWidth: 420, border: '1px solid #f0f0f0', borderRadius: 6 }}>
            {order.map((id, i) => (
              <div key={id} style={{ ...rowStyle, background: ticked.has(id) ? '#fff' : '#fafafa' }}>
                <Checkbox checked={ticked.has(id)} onChange={() => toggle(id)}>
                  <span style={{ color: ticked.has(id) ? undefined : '#999' }}>{headingOf(id)}</span>
                </Checkbox>
                <span>
                  <button type='button' style={arrowStyle} onClick={() => move(i, -1)} disabled={i === 0}
                    aria-label={`Move ${headingOf(id)} up`}><ArrowUpOutlined /></button>
                  <button type='button' style={arrowStyle} onClick={() => move(i, 1)} disabled={i === order.length - 1}
                    aria-label={`Move ${headingOf(id)} down`}><ArrowDownOutlined /></button>
                </span>
              </div>
            ))}
          </div>
          <div className='d-flex gap-2 mt-3'>
            <button type='button' className='btn-custom' onClick={() => save(chosen)} disabled={saving || !chosen.length}>
              {saving ? 'Saving…' : `Save (${chosen.length} columns)`}
            </button>
            <button type='button' className='btn-custom' onClick={() => save([])} disabled={saving} title={builtInHint}>
              Built-in
            </button>
          </div>
        </>
      )}
    </Section>
  );
};

/**
 * Where the period reports' From and To start - functions/reportDates (the
 * user, 2026-11-11: some clients need the start of the fiscal year to the end
 * of the year). Saved, it is remembered in this browser at once; everyone
 * else has it the next time they open Odyssey.
 */
export const ReportDatesCard = () => {
  const fiscalYears = useSelector((s) => s.fiscalYear?.fiscalYears);
  const [saved, setSaved] = useState(DEFAULT_REPORT_DATES);
  const [picked, setPicked] = useState(DEFAULT_REPORT_DATES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    axiosClient.get('/settings/reportDates')
      .then(({ data }) => {
        if (!alive) return;
        const value = normalizeReportDates(data?.result);
        setSaved(value);
        setPicked(value);
      })
      .catch(() => { if (alive) openNotification('Error', 'Could not load the report dates.', 'red'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const dirty = picked.from !== saved.from || picked.to !== saved.to;
  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/reportDates', picked);
      if (data.status !== 'success') throw new Error(data.result);
      const value = normalizeReportDates(data.result);
      setSaved(value);
      rememberReportDates(value, fiscalYears);
      openNotification('Success', 'Report dates saved.', 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  // What the choice gives today, so the admin sees the dates, not just words.
  const example = reportDateRange(undefined, { ...picked, fy: currentFiscalYear(fiscalYears) });

  return (
    <Section title='Report Dates' aria-label='Report Dates'
      hint={'Where the From and To dates start on Job Balancing, Invoice Balancing, Account Activity, '
        + 'Trial Balance, Income Statement, Ledger, Ageing, Job P&L, LG VAT and the Audit Log. Users can '
        + 'still pick any dates for a run. The fiscal year is the one in Setup > Fiscal Years that has '
        + 'today in it. Other users see a change the next time they open Odyssey.'}>
      {loading ? <Spin /> : (
        <>
          <SettingRow label='From starts on'>
            <Select style={{ width: 290 }} value={picked.from} options={FROM_CHOICES}
              aria-label='From starts on' onChange={(from) => setPicked((p) => ({ ...p, from }))} />
          </SettingRow>
          <SettingRow label='To starts on'>
            <Select style={{ width: 290 }} value={picked.to} options={TO_CHOICES}
              aria-label='To starts on' onChange={(to) => setPicked((p) => ({ ...p, to }))} />
          </SettingRow>
          <div style={{ fontSize: 12, color: '#555', marginTop: 6 }} data-testid='report-dates-example'>
            Today that is {example.from.format('DD-MM-YYYY')} to {example.to.format('DD-MM-YYYY')}.
          </div>
          <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </>
      )}
    </Section>
  );
};

/**
 * Where Job Balancing's Show Advance Transactions switch starts - the user,
 * 2026-11-10: SNS wants the advances on the report, CL does not, and switching
 * it off on every run would be a chore. Users can still move the switch for a
 * run. On until an admin turns it off - the report as it was.
 */
export const JobBalancingAdvancesCard = () => {
  const [saved, setSaved] = useState(true);
  const [on, setOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    axiosClient.get('/settings/jobBalancingAdvances')
      .then(({ data }) => {
        if (!alive) return;
        const enabled = data?.result?.enabled !== false;
        setSaved(enabled);
        setOn(enabled);
      })
      .catch(() => { if (alive) openNotification('Error', 'Could not load the Job Balancing setting.', 'red'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/jobBalancingAdvances', { enabled: on });
      if (data.status !== 'success') throw new Error(data.result);
      setSaved(data.result?.enabled !== false);
      openNotification('Success', 'Job Balancing setting saved.', 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title='Job Balancing — Advance Transactions' aria-label='Job Balancing — Advance Transactions'>
      {loading ? <Spin /> : (
        <>
          <SettingRow
            label='Show Advance Transactions by default'
            hint={'Payments and receipts not yet knocked off against an invoice, as rows of the report - '
              + 'so its bottom line agrees with the party’s ledger. This is where the report’s Show Advance '
              + 'Transactions switch starts; users can still turn it on or off for a run. Advances are never '
              + 'shown when the report is narrowed to some operation types or to an overseas agent.'}
          >
            <Switch checked={on} onChange={setOn} aria-label='Show Advance Transactions by default' />
          </SettingRow>
          <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || on === saved}>
            {saving ? 'Saving…' : on === saved ? 'Saved' : 'Save'}
          </button>
        </>
      )}
    </Section>
  );
};

const ReportColumns = () => {
  const mode = getMode();
  const jobBalancing = useMemo(() => jobBalancingColumns(mode), [mode]);
  // The S/R Page # under the install's name for it.
  const { form: customsForm } = useCustomsJobForm();
  const customsJobs = useMemo(() => customsJobListColumns(customsForm?.referenceLabel), [customsForm?.referenceLabel]);
  return (
    <div className='d-flex flex-column' style={{ gap: 16 }}>
      <ReportDatesCard />
      <ReportColumnsCard
        report={JOB_BALANCING_GRID}
        title='Job Balancing — Grid'
        description={'The columns the grid opens with, top to bottom as left to right, and what its Excel '
          + 'export carries. Users can still tick columns on and off for themselves on the report; its '
          + 'Default button comes back to these.'}
        available={jobBalancing}
        defaultsFor={(configured) => defaultColumnIds(jobBalancing, configured)}
        builtInHint='Every column, in the built-in order'
      />
      <JobBalancingAdvancesCard />
      {/* The VAT Detail is a customs report - see setAccesLevels. */}
      {mode === 'customs' && (
        <ReportColumnsCard
          report={VAT_DETAIL}
          title='VAT Detail'
          description={'The columns the VAT Detail opens with, top to bottom as left to right - on screen, '
            + 'in its print and in its Excel export. Built-in is ten: the return’s fifteen less CNIC, Buyer '
            + 'Type, Document Type, Sale Type and ST Withheld, which are the same on every row or never '
            + 'filled. The report’s Columns button changes them for the session, and its All gives the full '
            + 'fifteen.'}
          available={VAT_COLUMNS}
          defaultsFor={vatDefaultColumns}
          orderFor={vatPickerOrder}
          builtInHint='The built-in ten'
        />
      )}
      {/* Not a report, but its columns are picked the same way (2026-11-20). */}
      {mode === 'customs' && (
        <ReportColumnsCard
          report={CUSTOMS_JOB_LIST}
          title='Customs Jobs — List'
          description={'The columns the customs job list opens with, top to bottom as left to right. Users '
            + 'can still tick columns on and off for themselves with the list’s Columns button, kept in their '
            + 'browser; its Default comes back to these.'}
          available={customsJobs}
          defaultsFor={customsJobListDefaults}
          orderFor={customsJobListOrder}
          builtInHint='The built-in twelve'
        />
      )}
    </div>
  );
};

const rowStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '5px 10px', borderBottom: '1px solid #f0f0f0',
};
const arrowStyle = { background: 'none', border: 0, padding: '0 6px', cursor: 'pointer', color: '#555' };

export default ReportColumns;
