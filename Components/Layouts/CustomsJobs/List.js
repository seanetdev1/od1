import React, { useEffect, useState, useCallback } from 'react';
import { Table, Input, Tag, Spin, Select, Radio, DatePicker, Popover, Checkbox } from 'antd';
import axiosClient from 'apis/axiosClient';
import {
  CUSTOMS_JOB_LIST, customsJobListColumns, customsJobListDefaults, customsJobListOrder, customsJobListShown,
  readCustomsJobListPicks, writeCustomsJobListPicks,
} from 'functions/customsJobListColumns';
import moment from 'moment';
import { Row, Col } from 'react-bootstrap';
import Router from 'next/router';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import { getCustomsJobs } from 'apis/customsJobs';
import openNotification from 'Components/Shared/Notification';
import { money } from 'functions/customsDuty';
import {
  useCustomsStatuses, labelOf, colorOf as statusColor, startOf, entryOf,
} from 'functions/customsStatuses';
import { useSelectedCompany } from 'functions/selectedCompany';
import NoCompanySelected from 'Components/Shared/NoCompanySelected';
import { usePageActions } from 'Components/Shared/PageActions';
import { useCustomsJobForm } from 'functions/customsJobForm';
import { clientInvoiceNo } from 'functions/customsJobReference';

// The customs job list. One row per goods declaration, with its duty total
// rolled up so the list answers "what is this file worth" without opening it.

// One definition of a job's status and its colour, shared by the Status column
// and the filter tags above the table. Two copies would drift, and a filter
// tag coloured differently from the rows it selects is worse than no filter at
// all. The statuses - their names, colours and order - are Configuration >
// Customs' (functions/customsStatuses); the server validates against the same
// list, and the status filter queries it by stored value.
//
// `canceled` (the flag the Cancel Job button sets) wins over the status field,
// matching how the job page treats it.
const statusOf = (r, list) => (r?.canceled ? 'Canceled' : (r?.status || startOf(list)));

const List = ({ companyId: storeCompanyId }) => {
  // What this install calls the S/R Page # - Configuration > Customs.
  const { form: jobForm } = useCustomsJobForm();
  const dispatchTab = useDispatch();
  const jobList = useCustomsStatuses().job;
  const label = (s) => labelOf(jobList, s);
  const colorOf = (s) => statusColor(jobList, s);
  // Which columns - see allColumns below. The install's set, read once; this
  // browser's picks on top (null = the install's).
  const [configuredColumns, setConfiguredColumns] = useState(null);
  const [columnPicks, setColumnPicks] = useState(null);
  useEffect(() => {
    setColumnPicks(readCustomsJobListPicks());
    let alive = true;
    axiosClient.get(`/settings/reportColumns/${CUSTOMS_JOB_LIST}`)
      .then(({ data }) => { if (alive) setConfiguredColumns(data?.result || null); })
      .catch(() => {});   // not reachable: the built-in twelve
    return () => { alive = false; };
  }, []);
  const defaults = customsJobListDefaults(configuredColumns);
  const shownIds = customsJobListShown(defaults, columnPicks ?? defaults);
  const pickColumns = (ids) => { setColumnPicks(ids); writeCustomsJobListPicks(ids); };
  const toggleColumn = (id, on) => {
    const next = on ? [...shownIds, id] : shownIds.filter((x) => x !== id);
    if (next.length) pickColumns(next);
  };
  // STRICT: no company picked, no jobs - see functions/selectedCompany.
  const { ready, companyId } = useSelectedCompany(storeCompanyId);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // What is actually queried, as opposed to what is in the box. They differ
  // for half a second while somebody is still typing.
  const [searchTerm, setSearchTerm] = useState('');
  // THE LIST IS SERVED A PAGE AT A TIME. It used to fetch every job and let
  // the table paginate what it had - which on a migrated book is 15,364 jobs
  // and 146,890 joined rows to show twenty of them.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  // Per-status tallies for the filter tags, counted by the SERVER over
  // everything the other filters match. They cannot be counted here any more:
  // this component only ever holds one page.
  const [counts, setCounts] = useState({});
  // Server-side, unlike the status filter below: direction narrows the query
  // rather than the loaded page, because an installation accumulates thousands
  // of GDs and half of them are never the ones being looked for.
  const [direction, setDirection] = useState('');
  // Whether a job has been charged and billed. Server-side like the rest -
  // the answer lives in Charge_Heads, which this screen never loads.
  const [billing, setBilling] = useState('');
  /* A TIME PERIOD, by job date - Payments & Receipts' choices (the user,
     2026-11-14). All until another is picked, so the list opens as it did.
     Custom's dates apply on Apply, not as each is picked. `range` is the
     server's answer: the dates the period came to, shown beside it. */
  const [period, setPeriod] = useState('all');
  const [custom, setCustom] = useState({ from: null, to: null });
  const [applied, setApplied] = useState({ from: null, to: null });
  const [range, setRange] = useState(null);

  // Which statuses are being shown. EMPTY MEANS ALL - so the list opens
  // unfiltered and a user who deselects everything gets everything back rather
  // than an empty table with no way to explain it.
  const [statusFilter, setStatusFilter] = useState(() => new Set());

  const toggleStatus = (status) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
    // Back to page 1: page 7 of the old filter is not page 7 of the new one,
    // and landing past the end shows an empty table that looks like no results.
    setPage(1);
  };

  const load = useCallback(async (term, dir, statuses, bill, pageNo, size, when) => {
    if (!companyId) {
      setRows([]); setTotal(0); setCounts({}); setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await getCustomsJobs({
        companyId,
        search: term,
        direction: dir,
        status: [...(statuses || [])],
        billing: bill,
        page: pageNo,
        limit: size,
        ...(when || {}),
      });
      setRows(Array.isArray(res?.result) ? res.result : []);
      setRange(res?.period || null);
      setTotal(Number(res?.count) || 0);
      setCounts(res?.counts || {});
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not load customs jobs.', 'red');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // TYPE TO SEARCH, half a second after you stop.
  //
  // Two rules, both about not sending a query nobody wants yet:
  //
  //   - a single character is not a search, it is the first keystroke of one.
  //     Matching on it would scan 15,364 jobs to hand back most of them.
  //     Held, so the list keeps showing whatever it was showing.
  //   - clearing the box IS a search - for everything - so an empty string
  //     goes through and resets the list.
  //
  // The timer is cleared on every keystroke, so a fast typist sends exactly
  // one request rather than one per letter.
  useEffect(() => {
    const text = search.trim();
    if (text.length === 1) return undefined;

    const timer = setTimeout(() => {
      setSearchTerm((prev) => {
        // A new search starts at page 1; re-confirming the same one should not
        // yank somebody off page 3.
        if (prev !== text) setPage(1);
        return text;
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  // What the period asks the server for. A Custom with no dates applied yet
  // asks for nothing, rather than a fortnight the screen never offered.
  const when = period === 'all' ? null
    : period === 'custom' ? (applied.from && applied.to ? { period, from: applied.from, to: applied.to } : null)
    : { period };
  const whenKey = JSON.stringify(when);

  useEffect(() => {
    if (!ready) return;
    load(searchTerm, direction, statusFilter, billing, page, pageSize, when);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, load, searchTerm, direction, statusFilter, billing, page, pageSize, whenKey]);

  const showDate = (d) => (d ? moment(d, 'YYYY-MM-DD').format('DD-MM-YYYY') : '');
  /* The period, as Payments & Receipts lays it out: the choices, Custom's
     dates and Apply right beside it, and the dates it came to - so an empty
     list is never a mystery. */
  const periodBar = (
    <div className='cj-period d-flex align-items-center flex-wrap mb-2' style={{ gap: 8 }}>
      <b className='fs-12'>Period</b>
      <Radio.Group
        size='small'
        value={period}
        onChange={(e) => { setPeriod(e.target.value); setPage(1); }}
      >
        <Radio.Button value='fortnight'>Fortnight</Radio.Button>
        <Radio.Button value='month'>Month</Radio.Button>
        <Radio.Button value='quarter'>Quarter</Radio.Button>
        <Radio.Button value='fiscalYear'>Fiscal Year</Radio.Button>
        <Radio.Button value='all'>All</Radio.Button>
        {/* Last, so its dates open right beside it. */}
        <Radio.Button value='custom'>Custom</Radio.Button>
      </Radio.Group>
      {period === 'custom' && (
        <>
          <DatePicker
            size='small' format='DD-MM-YYYY' placeholder='From' aria-label='From'
            value={custom.from ? moment(custom.from, 'YYYY-MM-DD') : null}
            onChange={(d) => setCustom((c) => ({ ...c, from: d ? d.format('YYYY-MM-DD') : null }))}
          />
          <DatePicker
            size='small' format='DD-MM-YYYY' placeholder='To' aria-label='To'
            value={custom.to ? moment(custom.to, 'YYYY-MM-DD') : null}
            onChange={(d) => setCustom((c) => ({ ...c, to: d ? d.format('YYYY-MM-DD') : null }))}
          />
          <button
            type='button' className='btn-custom fs-11'
            disabled={!custom.from || !custom.to}
            onClick={() => { setApplied(custom); setPage(1); }}
          >Apply</button>
        </>
      )}
      {/* By JOB DATE - said, since the list shows GD dates beside it. */}
      <span className='grey-txt fs-12' data-testid='period-range'>
        {range ? `Job date ${showDate(range.from)} to ${showDate(range.to)}` : 'Every job date'}
      </span>
    </div>
  );

  // Opening a job registers a tab the same way the freight screens do, so it
  // behaves like the rest of the app rather than a dead-end page.
  // `id` is required, not decorative: MainLayout's setKey() builds the URL for
  // key 11-2 from tab.id, so a tab registered without one navigates to
  // /customsJobs/undefined and every save then posts the string "undefined".
  const open = (record) => {
    dispatchTab(incrementTab({ label: record.jobNo || 'Customs Job', key: '11-2', id: record.id }));
    Router.push(`/customsJobs/${record.id}`);
  };

  // The rows ARE the visible rows now - the status filter is applied by the
  // query, not by the table, so there is nothing left here to filter out.
  const visible = rows;

  // What is on THIS PAGE adds up to. Deliberately page-scoped and labelled as
  // such: a duty total across every page cannot be computed in SQL, because
  // the figure comes from the WeBOC cascade in functions/customsDuty.js and
  // not from a column. A number labelled as the whole book that is really one
  // page is worse than an honest page total.
  const totals = React.useMemo(() => {
    const t = { duty: 0, reimbursable: 0 };
    for (const r of visible) {
      t.duty += parseFloat(r.totalDuty) || 0;
      t.reimbursable += parseFloat(r.reimbursableDuty) || 0;
    }
    return t;
  }, [visible]);

  /* THE COLUMNS ARE PICKED (the user, 2026-11-20) - functions/
     customsJobListColumns. Every column the list can show is defined here;
     the Columns button ticks them on and off, from the install's set
     (Configuration > Reports) - the twelve below until one is saved. */
  const catalogue = React.useMemo(() => customsJobListColumns(jobForm.referenceLabel), [jobForm.referenceLabel]);
  const dash = <span className='grey-txt'>-</span>;
  const text = (v) => (v === null || v === undefined || v === '' ? dash : v);
  const day = (v) => (v && moment(v).isValid() ? moment(v).format('DD-MM-YYYY') : dash);
  const allColumns = [
    { title: 'Job No.', dataIndex: 'jobNo', key: 'jobNo' },
    // The S/R Page #, under the install's name for it (Essani's "File Job
    // Number") - asked for 2026-11-14, with the Client Invoice # below.
    { title: String(jobForm.referenceLabel || 'S/R Page #'), dataIndex: 'jobRef', key: 'jobRef',
      render: (v) => v || <span className='grey-txt'>-</span> },
    { title: 'GD No.', dataIndex: 'gdNumber', key: 'gdNumber', render: (v) => v || '-' },
    { title: 'GD Date', dataIndex: 'gdDate', key: 'gdDate', render: (v) => v || '-' },
    { title: 'Type', key: 'type',
      // Direction and mode read as one phrase - "Import · Sea" - because that
      // is how anyone describes a file out loud, and two columns for it would
      // cost width the duty figures need more.
      render: (_, r) => [r.direction, r.transportMode].filter(Boolean).join(' · ') || '-' },
    { title: 'Client', key: 'client', render: (_, r) => r.client?.name || '-' },
    // One number, whichever of its two columns holds it - see clientInvoiceNo.
    { title: 'Client Invoice #', key: 'clientInvoice',
      render: (_, r) => clientInvoiceNo(r) || <span className='grey-txt'>-</span> },
    // No B/L - AWB or Channel columns (the user, 2026-11-14) - the search
    // still finds a job by its B/L number.
    { title: 'Duty', key: 'totalDuty', align: 'right',
      // Derived on the server from the heads on the GD - see
      // functions/customsDuty.js. Never a stored column.
      render: (_, r) => money(r.totalDuty) },
    // How many invoices and bills the job's charges are on - counted by the
    // server through the charge lines, per page (routes/customsJobs /get).
    { title: 'Invoices', key: 'invoiceCount', align: 'center',
      render: (_, r) => r.invoiceCount || <span className='grey-txt'>-</span> },
    { title: 'Bills', key: 'billCount', align: 'center',
      render: (_, r) => r.billCount || <span className='grey-txt'>-</span> },
    // Who opened the job - the first History 'Create' (see the server).
    { title: 'Created By', key: 'createdByName',
      render: (_, r) => r.createdByName || <span className='grey-txt'>-</span> },
    { title: 'Status', key: 'status',
      render: (_, r) => <Tag color={colorOf(statusOf(r, jobList))}>{label(statusOf(r, jobList))}</Tag> },
    // The job's own fields, off until ticked.
    { title: 'Job Date', key: 'jobDate', render: (_, r) => day(r.jobDate) },
    { title: 'Shipper', key: 'shipper', render: (_, r) => text(r.shipper?.name) },
    { title: 'Consignee', key: 'consignee', render: (_, r) => text(r.consignee?.name) },
    { title: 'Shipping Line', key: 'shippingLine', render: (_, r) => text(r.shippingLine?.name) },
    // chaChbId - the job screen's "Freight Forwarder".
    { title: 'Freight Forwarder', key: 'forwarder', render: (_, r) => text(r.chaChb?.name) },
    { title: 'Transporter', key: 'transporter', render: (_, r) => text(r.transporter?.name) },
    { title: 'Commodity', key: 'commodity', render: (_, r) => text(r.Commodity?.name) },
    { title: 'B/L - AWB No.', key: 'blNo', render: (_, r) => text(r.blNo) },
    { title: 'Channel', key: 'channel', render: (_, r) => text(r.channel) },
    { title: 'Vessel / Flight', key: 'vesselOrFlight', render: (_, r) => text(r.vesselOrFlight) },
    { title: 'Voyage', key: 'voyageNo', render: (_, r) => text(r.voyageNo) },
    { title: 'IGM No.', key: 'igmNo', render: (_, r) => text(r.igmNo) },
    { title: 'Index No.', key: 'indexNo', render: (_, r) => text(r.indexNo) },
    { title: 'GD Type', key: 'gdType', render: (_, r) => text(r.gdType) },
    { title: 'Collectorate', key: 'collectorate', render: (_, r) => text(r.collectorate) },
    { title: 'Port of Loading', key: 'pol', render: (_, r) => text(r.pol) },
    { title: 'Port of Discharge', key: 'pod', render: (_, r) => text(r.pod) },
    { title: 'Terminal', key: 'terminal', render: (_, r) => text(r.terminal) },
    { title: 'Containers', key: 'containers', render: (_, r) => text(r.containers) },
    { title: 'Packages', key: 'packages', align: 'right',
      render: (_, r) => (r.packages ? `${r.packages}${r.pkgUnit ? ` ${r.pkgUnit}` : ''}` : dash) },
    { title: 'Gross Weight', key: 'grossWeight', align: 'right', render: (_, r) => text(r.grossWeight) },
    { title: 'Invoice Value', key: 'invoiceValue', align: 'right',
      render: (_, r) => (parseFloat(r.invoiceValue) ? `${r.invoiceCurrency ? `${r.invoiceCurrency} ` : ''}${money(r.invoiceValue)}` : dash) },
    { title: 'Form-E #', key: 'formENo', render: (_, r) => text(r.formENo) },
    { title: 'PSID', key: 'psid', render: (_, r) => text(r.psid) },
    { title: 'Duty Paid On', key: 'dutyPaidDate', render: (_, r) => day(r.dutyPaidDate) },
    { title: 'Reimbursable Duty', key: 'reimbursableDuty', align: 'right',
      render: (_, r) => (parseFloat(r.reimbursableDuty) ? money(r.reimbursableDuty) : dash) },
    { title: 'Arrival', key: 'arrivalDate', render: (_, r) => day(r.arrivalDate) },
    { title: 'Remarks', key: 'remarks', ellipsis: true, render: (_, r) => text(r.remarks) },
    { title: 'Created On', key: 'createdAt', render: (_, r) => day(r.createdAt) },
  ];
  const columns = shownIds.map((id) => allColumns.find((c) => c.key === id)).filter(Boolean);

  const columnPicker = (
    <div style={{ minWidth: 230 }}>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {customsJobListOrder(defaults).map((id) => (
          <div key={id}>
            <Checkbox checked={shownIds.includes(id)} onChange={(e) => toggleColumn(id, e.target.checked)}>
              {catalogue.find((c) => c.id === id)?.heading || id}
            </Checkbox>
          </div>
        ))}
      </div>
      <div className='d-flex justify-content-between mt-2 pt-2' style={{ borderTop: '1px solid #f0f0f0' }}>
        <button type='button' className='btn btn-link btn-sm p-0' onClick={() => pickColumns(null)}
          title='The columns set in Configuration > Reports'>Default</button>
        <button type='button' className='btn btn-link btn-sm p-0' onClick={() => pickColumns(catalogue.map((c) => c.id))}
          title='Every column'>All</button>
      </div>
    </div>
  );

  const filterBar = (
    <div className='status-filter'>
      <span className='label'>Status</span>
      {/* Every status - a retired one only while jobs are at it. */}
      {jobList.map((x) => x.value).filter((s) => !entryOf(jobList, s)?.hidden || counts[s]).map((s) => {
        const on = statusFilter.has(s);
        return (
          <Tag
            key={s}
            color={on ? colorOf(s) : undefined}
            className={`filter-tag ${on ? 'on' : 'off'}`}
            onClick={() => toggleStatus(s)}
            title={on ? `Stop showing ${label(s)} jobs` : `Show only ${label(s)} jobs`}
          >
            {label(s)} <b>{counts[s] ?? 0}</b>
          </Tag>
        );
      })}
      {statusFilter.size > 0 && (
        <a className='clear' onClick={() => setStatusFilter(new Set())}>
          Clear
        </a>
      )}
      <span className='showing'>
        {total === rows.length
          ? `${total} job${total === 1 ? '' : 's'}`
          : `${rows.length} of ${total.toLocaleString()}`}
        {/* Page-scoped, and says so - see the totals memo. */}
        {totals.duty > 0 && <>{' · '}duty on this page <b>{money(totals.duty)}</b></>}
        {/* Only shown when there is any, because on a file where the client
            paid customs direct it is always zero and says nothing. */}
        {totals.reimbursable > 0 && <> · reimbursable <b>{money(totals.reimbursable)}</b></>}
      </span>
    </div>
  );

  // The title and New on the toolbar (PageActions). Above the return for no
  // company: it is a hook.
  usePageActions({
    title: 'Customs Jobs',
    new: {
      onClick: () => {
        dispatchTab(incrementTab({ label: 'New Customs Job', key: '11-2', id: 'new' }));
        Router.push('/customsJobs/new');
      },
      label: 'New Customs Job',
      disabled: !companyId,
      title: companyId ? 'Create a new customs job' : 'Choose a company first',
    },
  }, [companyId]);

  if (ready && !companyId) return <NoCompanySelected />;

  return (
    <div className='client-styles'>
      <Row className='align-items-center mb-3'>
        <Col className='d-flex justify-content-end' style={{ gap: '0.5rem' }}>
          <Select
            style={{ width: 130 }}
            value={direction || undefined}
            placeholder='All'
            allowClear
            onChange={(v) => { setDirection(v || ''); setPage(1); }}
            options={[{ value: 'Import', label: 'Import' }, { value: 'Export', label: 'Export' }]}
          />
          {/* Billing state. One list rather than two toggles, because "no
              charges" and "invoiced" cannot both be true and a pair of
              checkboxes would let somebody ask for that. */}
          <Select
            style={{ width: 190 }}
            value={billing || undefined}
            placeholder='Any billing'
            allowClear
            onChange={(v) => { setBilling(v || ''); setPage(1); }}
            options={[
              { value: 'charged', label: 'Has charges' },
              { value: 'uncharged', label: 'No charges' },
              { value: 'invoiced', label: 'Invoiced' },
              // Charged but none of it billed - the work worth chasing. NOT
              // the same as "no charges", which is a file nobody has costed.
              { value: 'uninvoiced', label: 'Billable, not invoiced' },
            ]}
          />
          <Input
            // One box for the client and five numbers. The thing someone has
            // in hand is as often the customer's name as the declaration's
            // number, and asking them which box to type it in is a question
            // the screen can answer itself. The S/R page is in there because
            // it is the reference a file HAS before it has a GD number - see
            // the field on the job form, and the search in routes/customsJobs.
            //
            // No search button: it runs itself once typing stops. See the
            // debounce above.
            placeholder={`Client, GD, B/L, ${String(jobForm.referenceLabel || 'S/R Page').replace(/\s*#$/, '')}, Client Invoice, Container or Job No.`}
            style={{ width: 420 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
          <Popover trigger='click' placement='bottomRight' title='Columns' content={columnPicker}>
            <button type='button' className='btn-custom' title='Choose the columns'>Columns ({shownIds.length})</button>
          </Popover>
        </Col>
      </Row>

      {periodBar}
      {!loading && filterBar}

      {loading ? <div className='text-center py-5'><Spin /></div> : (
        <Table
          rowKey='id'
          size='small'
          dataSource={visible}
          columns={columns}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['25', '50', '100', '200'],
            showTotal: (n, range) => `${range[0]}-${range[1]} of ${n.toLocaleString()}`,
            onChange: (p, size) => { setPage(p); setPageSize(size); },
          }}
          locale={{
            emptyText: statusFilter.size
              ? `No ${[...statusFilter].join(' or ')} jobs.`
              : 'No customs jobs yet.',
          }}
          onRow={(record) => ({
            onClick: () => open(record),
            style: { cursor: 'pointer' },
          })}
        />
      )}

      <style jsx global>{`
        /* The period's buttons at their own width. .client-styles gives every
           <label> a 170px minimum (styles/clientLayout.scss) - meant for form
           labels - and each of these buttons is a label, so the six stretched
           across the whole page. Payments & Receipts is not under it. */
        .client-styles .cj-period .ant-radio-button-wrapper {
          min-width: 0 !important;
        }
        .status-filter {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 10px;
          font-size: 12px;
        }
        .status-filter .label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          margin-right: 2px;
        }
        .status-filter .filter-tag {
          cursor: pointer;
          margin-right: 0;
          user-select: none;
        }
        /* Unselected tags keep the same shape but drop the colour, so the bar
           reads as a set of switches rather than as status labels. */
        .status-filter .filter-tag.off {
          background: #fafafa;
          border-color: #e0e0e0;
          color: #999;
        }
        .status-filter .filter-tag.off:hover { border-color: #bbb; color: #666; }
        .status-filter .clear {
          color: #1890ff;
          cursor: pointer;
          margin-left: 2px;
        }
        .status-filter .showing {
          margin-left: auto;
          color: #999;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
};

export default List;
