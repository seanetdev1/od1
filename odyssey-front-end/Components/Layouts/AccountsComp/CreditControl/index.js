import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, Button, DatePicker, Modal, Input, Drawer, Alert, Spin, Radio, Space, Empty } from 'antd';
import moment from 'moment';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { formatPkr } from 'functions/creditBlocks';
import { usePageActions } from 'Components/Shared/PageActions';

/* CREDIT CONTROL - the approvers' screen (CEO / CFO by default; Config >
 * Credit Control says who). The rules are the backend's functions/creditControl:
 *
 *   Requests   someone picked a blocked party as a job's client and asked;
 *              approve until a date, or reject
 *   Blocked    parties over their Credit Limit (Amount): let one through
 *              until a date, or end an approval early
 *   Flagged    parties over a limit of either kind, as of now; open one to
 *              omit invoices - an omitted invoice is in no email and does not
 *              count towards the limit (the user's rule: the backlog is
 *              reminded about "until a CFO or CEO omits it")
 *   Backlog    omit every open invoice dated before a day in one go, and see
 *              or undo what has been omitted
 *
 * BILLS (2026-10-26): the open bills we owe a party count against its
 * invoices - the limit is checked on the NET (balancePkr), so the screen shows
 * invoices, bills and net, a party's bills beside its invoices, and the
 * backlog takes out old bills with old invoices.
 */
const day = (v) => (v ? moment(v).format('DD-MM-YYYY') : '');
const when = (v) => (v ? moment(v).format('DD-MM-YYYY HH:mm') : '');
/* A small label in the shared look (styles/dataList .dl-badge) - it was an
 * antd Tag in its own colours. */
const Badge = ({ tone, children, title }) => <span className={`dl-badge${tone ? ` tone-${tone}` : ''}`} title={title}>{children}</span>;

const errorOf = (e, fallback) => e?.response?.data?.result || e?.message || fallback;

const post = async (url, body) => {
  const { data } = await axiosClient.post(url, body);
  if (data?.status !== 'success') throw new Error(data?.result || 'Failed.');
  return data.result;
};

/** "Until" picker + note, for an approval. */
const ApproveModal = ({ open, title, defaultDays, onOk, onCancel, withNote = true }) => {
  const [until, setUntil] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setUntil(moment().add(defaultDays || 7, 'days')); setNote(''); } }, [open, defaultDays]);
  return (
    <Modal open={open} title={title} okText='Approve' confirmLoading={busy} onCancel={onCancel} destroyOnClose
      onOk={async () => { setBusy(true); try { await onOk({ until: until?.format('YYYY-MM-DD'), note }); } finally { setBusy(false); } }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Can be the client on new jobs until the end of</div>
      <DatePicker value={until} onChange={setUntil} format='DD-MM-YYYY' allowClear={false}
        disabledDate={(d) => d && d.isBefore(moment().startOf('day'))} />
      {withNote && (
        <>
          <div style={{ fontSize: 12, color: '#666', margin: '12px 0 4px' }}>Note (optional)</div>
          <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </>
      )}
    </Modal>
  );
};

const CreditControl = () => {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState('');
  const [requests, setRequests] = useState([]);
  const [requestFilter, setRequestFilter] = useState('pending');
  // Which list is shown - a choice in the toolbar (2026-11-16 redesign; it
  // was a row of tabs), as the Voucher List chooses its kind.
  const [section, setSection] = useState('requests');
  const [approving, setApproving] = useState(null); // { kind: 'request'|'party', id, name }
  const [rejecting, setRejecting] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [party, setParty] = useState(null);        // the drawer's { client, invoices, bills, receivablePkr, payablePkr, balancePkr }
  const [picked, setPicked] = useState([]);
  const [omitReason, setOmitReason] = useState('');
  const [backlogDate, setBacklogDate] = useState(null);
  const [backlogCount, setBacklogCount] = useState(null);
  const [backlogSplit, setBacklogSplit] = useState(null); // { invoices, bills }
  const [omitted, setOmitted] = useState({ count: 0, rows: [] });

  const loadOverview = useCallback(() => {
    setLoading(true);
    return axiosClient.get('/creditControl/overview')
      .then(({ data }) => setOverview(data.result))
      .catch((e) => (e?.response?.status === 403 ? setForbidden(errorOf(e, 'Not allowed.')) : openNotification('Error', errorOf(e, 'Could not load credit control.'), 'red')))
      .finally(() => setLoading(false));
  }, []);

  const loadRequests = useCallback((status = requestFilter) => axiosClient.get('/creditControl/requests', { params: status === 'all' ? {} : { status } })
    .then(({ data }) => setRequests(data.result || []))
    .catch(() => {}), [requestFilter]);

  const loadOmitted = useCallback(() => axiosClient.get('/creditControl/omitted', { params: { limit: 300 } })
    .then(({ data }) => setOmitted(data.result || { count: 0, rows: [] }))
    .catch(() => {}), []);

  useEffect(() => { loadOverview(); loadRequests('pending'); loadOmitted(); }, [loadOverview, loadRequests, loadOmitted]);

  const refresh = () => Promise.all([loadOverview(), loadRequests(), loadOmitted()]);

  const openParty = async (clientId) => {
    try {
      const { data } = await axiosClient.get('/creditControl/partyInvoices', { params: { clientId } });
      setParty(data.result);
      setPicked([]);
      setOmitReason('');
    } catch (e) {
      openNotification('Error', errorOf(e, 'Could not load the invoices.'), 'red');
    }
  };

  const omit = async (omitIt) => {
    try {
      const r = await post('/creditControl/omit', { invoiceIds: picked, omit: omitIt, reason: omitReason });
      openNotification('Done', omitIt ? `${r.omitted} invoice(s) omitted.` : `${r.restored} invoice(s) put back.`, 'green');
      await openParty(party.client.id);
      refresh();
    } catch (e) {
      openNotification('Error', errorOf(e, 'Could not change them.'), 'red');
    }
  };

  const approve = async ({ until, note }) => {
    try {
      if (approving.kind === 'request') await post('/creditControl/decide', { id: approving.id, approve: true, until, note });
      else await post('/creditControl/allow', { clientId: approving.id, until, note });
      openNotification('Approved', `${approving.name} can be used on jobs until ${moment(until).format('DD-MM-YYYY')}.`, 'green');
      setApproving(null);
      refresh();
    } catch (e) {
      openNotification('Error', errorOf(e, 'Could not approve.'), 'red');
    }
  };

  const reject = async () => {
    try {
      await post('/creditControl/decide', { id: rejecting.id, approve: false, note: rejectNote });
      openNotification('Rejected', `The request for ${rejecting.name} was rejected.`, 'orange');
      setRejecting(null);
      refresh();
    } catch (e) {
      openNotification('Error', errorOf(e, 'Could not reject.'), 'red');
    }
  };

  const reblock = (row) => Modal.confirm({
    title: `Block ${row.name} again?`,
    content: 'Its approval ends now. While it is over its limit it cannot be the client on a new job.',
    okText: 'Block again',
    onOk: async () => {
      try { await post('/creditControl/reblock', { clientId: row.clientId }); refresh(); } catch (e) { openNotification('Error', errorOf(e, 'Could not block it.'), 'red'); }
    },
  });

  const countBacklog = async (d) => {
    setBacklogDate(d);
    setBacklogCount(null);
    setBacklogSplit(null);
    if (!d) return;
    try {
      const r = await post('/creditControl/omitBefore', { date: d.format('YYYY-MM-DD'), preview: true });
      setBacklogCount(r.count);
      setBacklogSplit({ invoices: r.invoices ?? r.count, bills: r.bills ?? 0 });
    } catch (e) {
      openNotification('Error', errorOf(e, 'Could not count them.'), 'red');
    }
  };

  const omitBacklog = () => Modal.confirm({
    title: `Omit ${backlogSplit?.invoices ?? backlogCount} open invoice(s)${backlogSplit?.bills ? ` and ${backlogSplit.bills} bill(s)` : ''} dated before ${backlogDate.format('DD-MM-YYYY')}?`,
    content: 'They leave every credit email and stop counting towards credit limits - bills as well as invoices, since a party\'s bills count against its invoices. Each can be put back from the list below.',
    okText: 'Omit them',
    onOk: async () => {
      try {
        const r = await post('/creditControl/omitBefore', { date: backlogDate.format('YYYY-MM-DD'), reason: omitReason || undefined });
        openNotification('Done', r.bills ? `${r.invoices} invoice(s) and ${r.bills} bill(s) omitted.` : `${r.omitted} invoice(s) omitted.`, 'green');
        setBacklogDate(null); setBacklogCount(null); setBacklogSplit(null);
        refresh();
      } catch (e) {
        openNotification('Error', errorOf(e, 'Could not omit them.'), 'red');
      }
    },
  });

  const putBack = async (invoiceIds) => {
    try {
      const r = await post('/creditControl/omit', { invoiceIds, omit: false });
      openNotification('Done', `${r.restored} invoice(s) put back.`, 'green');
      refresh();
    } catch (e) {
      openNotification('Error', errorOf(e, 'Could not put them back.'), 'red');
    }
  };

  const approvalDays = overview?.settings?.approvalDays;

  const requestColumns = useMemo(() => [
    { title: 'Party', render: (_, r) => <span className='dl-strong'>{r.Client?.name}{r.Client?.code ? <span className='dl-muted'> ({r.Client.code})</span> : ''}</span> },
    { title: 'Asked by', render: (_, r) => r.requestedBy?.name || '' },
    { title: 'When', render: (_, r) => when(r.createdAt) },
    { title: 'Note', dataIndex: 'note', render: (v) => <span style={{ whiteSpace: 'pre-wrap' }}>{v}</span> },
    { title: 'Status', render: (_, r) => (r.status === 'pending' ? <Badge tone='amber'>Waiting</Badge>
      : r.status === 'approved' ? <Badge tone='green'>Approved{r.approvedUntil ? ` until ${day(r.approvedUntil)}` : ''}</Badge>
        : <Badge tone='red'>Rejected</Badge>) },
    { title: 'Decided', render: (_, r) => (r.decidedBy ? `${r.decidedBy.name}, ${when(r.decidedAt)}${r.decisionNote ? ` - ${r.decisionNote}` : ''}` : '') },
    { title: '', render: (_, r) => r.status === 'pending' && (
      <Space>
        <Button size='small' type='primary' onClick={() => setApproving({ kind: 'request', id: r.id, name: r.Client?.name })}>Approve</Button>
        <Button size='small' danger onClick={() => { setRejectNote(''); setRejecting({ id: r.id, name: r.Client?.name }); }}>Reject</Button>
      </Space>
    ) },
  ], []);

  const blockColumns = [
    { title: 'Party', render: (_, r) => <span className='dl-strong'>{r.name}{r.code ? <span className='dl-muted'> ({r.code})</span> : ''}</span> },
    { title: 'Net owed (PKR)', align: 'right', render: (_, r) => formatPkr(r.balancePkr) },
    { title: 'Limit (PKR)', align: 'right', render: (_, r) => formatPkr(r.limitPkr) },
    { title: 'Blocked since', render: (_, r) => day(r.blockedAt) },
    { title: 'Status', render: (_, r) => (r.holding ? <Badge tone='red'>Blocked</Badge>
      : <Badge tone='green'>Allowed until {day(r.approvedUntil)}{r.approvedBy ? ` (${r.approvedBy})` : ''}</Badge>) },
    { title: '', render: (_, r) => (
      <Space>
        <Button size='small' onClick={() => setApproving({ kind: 'party', id: r.clientId, name: r.name })}>{r.holding ? 'Allow until…' : 'Change date'}</Button>
        {!r.holding && <Button size='small' danger onClick={() => reblock(r)}>Block again</Button>}
        <Button size='small' type='link' onClick={() => openParty(r.clientId)}>Invoices</Button>
      </Space>
    ) },
  ];

  const flaggedColumns = [
    { title: 'Party', render: (_, r) => <span className='dl-strong'>{r.name}{r.code ? <span className='dl-muted'> ({r.code})</span> : ''}</span> },
    { title: 'Credit (days)', align: 'right', dataIndex: 'creditLimitDays' },
    { title: 'Overdue invoices', align: 'right', dataIndex: 'overdue' },
    { title: 'Oldest (days)', align: 'right', dataIndex: 'oldest' },
    { title: 'Invoices (PKR)', align: 'right', render: (_, r) => formatPkr(r.receivablePkr ?? r.balancePkr) },
    { title: 'Our bills (PKR)', align: 'right', render: (_, r) => (r.payablePkr ? formatPkr(r.payablePkr) : '') },
    { title: 'Net owed (PKR)', align: 'right', render: (_, r) => formatPkr(r.balancePkr) },
    { title: 'Limit (PKR)', align: 'right', render: (_, r) => (r.limitPkr == null ? '' : formatPkr(r.limitPkr)) },
    { title: '', render: (_, r) => (
      <Space size={4}>
        {r.over && <Badge tone={r.blocked && !(r.approvedUntil && moment(r.approvedUntil).isAfter()) ? 'red' : 'amber'}>Over limit</Badge>}
        {r.overdue > 0 && <Badge tone='amber'>Overdue</Badge>}
        {!r.salesRepId && <Badge>No sales rep</Badge>}
      </Space>
    ) },
    { title: '', render: (_, r) => <Button size='small' type='link' onClick={() => openParty(r.clientId)}>Invoices</Button> },
  ];

  /* One `picked` list across the invoices and the bills - both are omitted
   * the same way - with each table ticking only its own rows. */
  const selectionFor = (rows = []) => {
    const mine = new Set(rows.map((r) => r.id));
    return {
      selectedRowKeys: picked.filter((id) => mine.has(id)),
      onChange: (keys) => setPicked([...picked.filter((id) => !mine.has(id)), ...keys]),
    };
  };

  const invoiceColumns = [
    { title: 'Invoice', dataIndex: 'invoiceNo' },
    { title: 'Job', dataIndex: 'jobNo' },
    { title: 'Date', dataIndex: 'date', render: (v) => (v ? moment(v).format('DD-MM-YYYY') : '') },
    { title: 'Age (days)', dataIndex: 'ageDays', align: 'right' },
    { title: 'Currency', dataIndex: 'currency' },
    { title: 'Balance', dataIndex: 'balance', align: 'right', render: formatPkr },
    { title: 'PKR', dataIndex: 'balancePkr', align: 'right', render: formatPkr },
    { title: '', dataIndex: 'omitted', render: (v) => (v ? <Badge>Omitted</Badge> : null) },
  ];

  // The title on the toolbar (PageActions). Above the return for no access:
  // it is a hook.
  usePageActions({ title: 'Credit Control' }, []);

  if (forbidden) return <div className='base-page-layout'><Alert type='warning' showIcon message={forbidden} /></div>;

  const s = overview?.settings;
  return (
    <div className='base-page-layout cc-screen'>
      {s && !s.enabled && (
        <Alert type='info' showIcon style={{ marginBottom: 12 }}
          message='Credit control is switched off'
          description='Nothing is emailed or blocked until it is switched on in Configuration > Credit Control. The parties below are as they stand now.' />
      )}
      {s && s.enabled && !s.blocking && (
        <Alert type='info' showIcon style={{ marginBottom: 12 }} message='Blocking is switched off - parties over their limit are reported, not blocked.' />
      )}
      {/* WHICH LIST - with how many each holds, as the tabs had. */}
      <div className='dl-toolbar'>
        <Radio.Group className='dl-segmented' value={section} onChange={(e) => setSection(e.target.value)}>
          <Radio.Button value='requests'>{`Requests${overview?.pending ? ` (${overview.pending})` : ''}`}</Radio.Button>
          <Radio.Button value='blocked'>{`Blocked${overview?.blocks?.length ? ` (${overview.blocks.length})` : ''}`}</Radio.Button>
          <Radio.Button value='flagged'>{`Flagged${overview?.flagged?.length ? ` (${overview.flagged.length})` : ''}`}</Radio.Button>
          <Radio.Button value='backlog'>{`Omitted${overview?.omitted ? ` (${overview.omitted})` : ''}`}</Radio.Button>
        </Radio.Group>
        {section === 'requests' && (
          <Radio.Group className='dl-segmented' size='small' value={requestFilter}
            onChange={(e) => { setRequestFilter(e.target.value); loadRequests(e.target.value); }}>
            <Radio.Button value='pending'>Waiting</Radio.Button>
            <Radio.Button value='approved'>Approved</Radio.Button>
            <Radio.Button value='rejected'>Rejected</Radio.Button>
            <Radio.Button value='all'>All</Radio.Button>
          </Radio.Group>
        )}
        <span className='dl-total'>{loading && <Spin size='small' />}</span>
      </div>

      <div className='dl-antd cc-section'>
        {section === 'requests' && (
          <Table size='small' rowKey='id' columns={requestColumns} dataSource={requests} pagination={{ pageSize: 20 }}
            locale={{ emptyText: <Empty description={requestFilter === 'pending' ? 'Nothing waiting' : 'None'} /> }} />
        )}
        {section === 'blocked' && (
          <>
            <p className='dl-note'>Parties over their credit limit (amount). Let one onto new jobs until a date, or end an approval early.</p>
            <Table size='small' rowKey='clientId' columns={blockColumns} dataSource={overview?.blocks || []} pagination={{ pageSize: 20 }}
              locale={{ emptyText: <Empty description='Nobody is blocked' /> }} />
          </>
        )}
        {section === 'flagged' && (
          <>
            <p className='dl-note'>Parties with a credit limit that are over it, as of now. Open a party to omit invoices from credit control.</p>
            <Table size='small' rowKey='clientId' columns={flaggedColumns} dataSource={overview?.flagged || []} pagination={{ pageSize: 25 }}
              locale={{ emptyText: <Empty description='Nobody is over a limit' /> }} />
          </>
        )}
        {section === 'backlog' && (
          <>
            <div className='cc-backlog'>
              <span className='cc-backlog-label'>Omit every open invoice and bill dated before</span>
              <DatePicker value={backlogDate} onChange={countBacklog} format='DD-MM-YYYY' />
              <Input style={{ width: 260 }} placeholder='Reason (optional)' value={omitReason} onChange={(e) => setOmitReason(e.target.value)} />
              <Button type='primary' danger disabled={!backlogDate || !backlogCount} onClick={omitBacklog}>
                {backlogDate && backlogCount !== null ? `Omit ${backlogCount}` : 'Omit'}
              </Button>
            </div>
            <Table size='small' rowKey='id' pagination={{ pageSize: 25 }}
              title={() => `${omitted.count} omitted${omitted.count > omitted.rows.length ? ` - the latest ${omitted.rows.length} shown` : ''}`}
              dataSource={omitted.rows}
              locale={{ emptyText: <Empty description='Nothing omitted' /> }}
              columns={[
                { title: 'Invoice / bill', render: (_, r) => <span className='dl-strong'>{r.Invoice?.invoice_No}</span> },
                { title: 'Party', render: (_, r) => r.Invoice?.party_Name },
                { title: 'Date', render: (_, r) => day(r.Invoice?.createdAt) },
                { title: 'Omitted by', render: (_, r) => <span className='dl-muted'>{`${r.omittedBy?.name || ''}, ${when(r.createdAt)}`}</span> },
                { title: 'Reason', dataIndex: 'reason' },
                { title: '', render: (_, r) => <Button size='small' type='link' onClick={() => putBack([r.InvoiceId])}>Put back</Button> },
              ]} />
          </>
        )}
      </div>

      <ApproveModal open={Boolean(approving)} title={`Let ${approving?.name || ''} onto jobs`} defaultDays={approvalDays}
        onOk={approve} onCancel={() => setApproving(null)} />

      <Modal open={Boolean(rejecting)} title={`Reject the request for ${rejecting?.name || ''}?`} okText='Reject' okButtonProps={{ danger: true }}
        onOk={reject} onCancel={() => setRejecting(null)} destroyOnClose>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Why (optional) - the person who asked is told</div>
        <Input.TextArea rows={2} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} maxLength={2000} />
      </Modal>

      <Drawer open={Boolean(party)} width={900} onClose={() => setParty(null)} destroyOnClose
        title={party ? `${party.client?.name}${party.client?.code ? ` (${party.client.code})` : ''} - open invoices and bills` : ''}>
        {party && (
          <>
            <div className='dl-stats'>
              <div className='dl-stat'>
                <span className='dl-stat-label'>Credit</span>
                <span className='dl-stat-value'>{party.client?.creditLimitDays ?? '—'} days</span>
              </div>
              <div className='dl-stat'>
                <span className='dl-stat-label'>Limit</span>
                <span className='dl-stat-value'>{party.client?.creditLimitAmount == null ? '—' : `PKR ${formatPkr(party.client.creditLimitAmount)}`}</span>
              </div>
              {party.balancePkr != null && (
                <div className={`dl-stat ${party.client?.creditLimitAmount != null && party.balancePkr > party.client.creditLimitAmount ? 'is-due' : 'is-clear'}`}>
                  <span className='dl-stat-label'>Net owed</span>
                  <span className='dl-stat-value'>PKR {formatPkr(party.balancePkr)}</span>
                </div>
              )}
            </div>
            {party.balancePkr != null && (
              <div data-testid='party-net' className='dl-note'>
                Open invoices PKR {formatPkr(party.receivablePkr)} − our bills PKR {formatPkr(party.payablePkr)} ={' '}
                <b>net {party.balancePkr < 0 ? `PKR ${formatPkr(-party.balancePkr)} in their favour` : `PKR ${formatPkr(party.balancePkr)}`}</b>
                <span style={{ color: '#888' }}> - what the limit is checked against; omitted ones are not counted.</span>
              </div>
            )}
            <Space style={{ marginBottom: 8 }} wrap>
              <Input style={{ width: 280 }} placeholder='Reason (optional)' value={omitReason} onChange={(e) => setOmitReason(e.target.value)} />
              <Button type='primary' danger disabled={!picked.length} onClick={() => omit(true)}>Omit {picked.length || ''}</Button>
              <Button disabled={!picked.length} onClick={() => omit(false)}>Put back</Button>
            </Space>
            <div className='dl-antd'>
              <Table size='small' rowKey='id' columns={invoiceColumns} dataSource={party.invoices} pagination={{ pageSize: 50 }}
                rowSelection={selectionFor(party.invoices)} />
            </div>
            {party.bills?.length > 0 && (
              <>
                <h6 className='cc-sub'>Our open bills to them ({party.bills.length})</h6>
                <div className='dl-antd'>
                  <Table size='small' rowKey='id' pagination={{ pageSize: 50 }}
                    columns={[{ ...invoiceColumns[0], title: 'Bill' }, ...invoiceColumns.slice(1)]}
                    dataSource={party.bills} rowSelection={selectionFor(party.bills)} />
                </div>
              </>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
};

export default CreditControl;
