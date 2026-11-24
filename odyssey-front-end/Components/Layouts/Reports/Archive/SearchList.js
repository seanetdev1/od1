import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Table, Input, DatePicker, Select, Checkbox, Tag } from 'antd';
import openNotification from 'Components/Shared/Notification';
import { archiveGet, showDate, money, DAY } from './shared';

// ONE SEARCH LIST for the archive's jobs, invoices, bills and vouchers: a
// search box, a date range, and the matches newest first, a page at a time
// from the server. Clicking a row opens the record (onOpen).

const voidTag = (v) => (v ? <Tag color='red'>Void</Tag> : null);
const ellipsis = (v) => <span title={v}>{v}</span>;

const KINDS = {
  jobs: {
    path: 'jobs',
    placeholder: 'Job no., B/L, GD no., client, client ref., container, IGM…',
    rowKey: 'id',
    open: (r) => ({ kind: 'job', id: r.id, label: r.jobNo }),
    columns: [
      { title: 'Job No', dataIndex: 'jobNo', width: 110 },
      { title: 'Date', dataIndex: 'jobDate', width: 105, render: showDate },
      { title: 'Customer', dataIndex: 'customer', ellipsis: { showTitle: false }, render: ellipsis },
      { title: 'Mode', dataIndex: 'mode', width: 70 },
      { title: 'Imp / Exp', dataIndex: 'direction', width: 80 },
      { title: 'HBL / HAWB', dataIndex: 'hbl', width: 140, ellipsis: { showTitle: false }, render: ellipsis },
      { title: 'MBL / MAWB', dataIndex: 'mbl', width: 140, ellipsis: { showTitle: false }, render: ellipsis },
      { title: 'GD No', dataIndex: 'gdNo', width: 120, ellipsis: { showTitle: false }, render: ellipsis },
      { title: 'Status', dataIndex: 'status', width: 75 },
    ],
  },
  invoices: {
    path: 'invoices',
    placeholder: 'Invoice no., party, job no., GST invoice no.…',
    rowKey: 'id',
    open: (r) => ({ kind: 'invoice', id: r.id, label: r.number }),
    columns: [
      { title: 'Invoice No', dataIndex: 'number', width: 115 },
      { title: 'Date', dataIndex: 'date', width: 105, render: showDate },
      { title: 'Kind', dataIndex: 'kind', width: 95 },
      { title: 'Party', dataIndex: 'party', ellipsis: { showTitle: false }, render: ellipsis },
      { title: 'Job No', dataIndex: 'jobNo', width: 110 },
      { title: 'GST Inv', dataIndex: 'gstNo', width: 100 },
      { title: 'Sales Tax', dataIndex: 'tax', width: 105, align: 'right', render: money },
      { title: 'Amount', dataIndex: 'amount', width: 120, align: 'right', render: money },
      { title: '', dataIndex: 'isVoid', width: 60, render: voidTag },
    ],
  },
  bills: {
    path: 'bills',
    placeholder: 'Bill no., vendor or account, job no., vendor\'s bill no.…',
    rowKey: 'id',
    open: (r) => ({ kind: 'bill', id: r.id, label: r.number }),
    columns: [
      { title: 'Bill No', dataIndex: 'number', width: 115 },
      { title: 'Date', dataIndex: 'date', width: 105, render: showDate },
      { title: 'Kind', dataIndex: 'kind', width: 115 },
      { title: 'Vendor / Account', dataIndex: 'party', ellipsis: { showTitle: false }, render: ellipsis },
      { title: 'Job No', dataIndex: 'jobNo', width: 110 },
      { title: 'Vendor Bill', dataIndex: 'vendorBillNo', width: 110, ellipsis: { showTitle: false }, render: ellipsis },
      { title: 'Amount', dataIndex: 'amount', width: 120, align: 'right', render: money },
      { title: '', dataIndex: 'isVoid', width: 60, render: voidTag },
    ],
  },
  vouchers: {
    path: 'vouchers',
    placeholder: 'Voucher no., cheque no., paid to / received by, reference…',
    rowKey: 'tranNo',
    open: (r) => ({ kind: 'voucher', id: r.tranNo, label: r.voucherNo }),
    columns: [
      { title: 'Voucher No', dataIndex: 'voucherNo', width: 115 },
      { title: 'Date', dataIndex: 'date', width: 105, render: showDate },
      { title: 'Type', dataIndex: 'type', width: 60 },
      { title: 'Account', dataIndex: 'account', width: 170, ellipsis: { showTitle: false }, render: ellipsis },
      { title: 'Cheque', dataIndex: 'chequeNo', width: 95, ellipsis: { showTitle: false }, render: ellipsis },
      { title: 'Narration', dataIndex: 'narration', ellipsis: { showTitle: false }, render: ellipsis },
      { title: 'Amount', dataIndex: 'amount', width: 120, align: 'right', render: money },
      { title: '', dataIndex: 'isVoid', width: 60, render: voidTag },
    ],
  },
};

const VOUCHER_TYPES = ['CRV', 'CPV', 'BRV', 'BPV', 'JV', 'SI', 'PI', 'TV', 'DN', 'CN', 'CR'];

const SearchList = ({ book, kind, onOpen }) => {
  const cfg = KINDS[kind];
  const [text, setText] = useState('');
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [type, setType] = useState(undefined);
  const [narration, setNarration] = useState(false);
  const [page, setPage] = useState({ current: 1, pageSize: 50 });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  // The newest request wins: a slow search answered after a quicker later
  // one must not replace it.
  const latest = useRef(0);

  const run = useCallback(async (at = { current: 1, pageSize: page.pageSize }) => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const res = await archiveGet(book, cfg.path, {
        q: text.trim() || undefined,
        from: from ? from.format(DAY) : undefined,
        to: to ? to.format(DAY) : undefined,
        type: kind === 'vouchers' ? type : undefined,
        narration: kind === 'vouchers' && narration ? 1 : undefined,
        page: at.current,
        pageSize: at.pageSize,
      });
      if (ticket !== latest.current) return;
      setResult(res);
      setPage(at);
    } catch (e) {
      if (ticket === latest.current) openNotification('Error', e.message, 'red');
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [book, cfg.path, kind, text, from, to, type, narration, page.pageSize]);

  // The newest first, as soon as the tab opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [book]);

  return (
    <div className='archive-search'>
      <div className='archive-filters'>
        <Input.Search
          allowClear
          placeholder={cfg.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onSearch={() => run()}
          enterButton='Search'
          style={{ maxWidth: 460 }}
        />
        <span className='grey-txt'>From</span>
        <DatePicker value={from} onChange={setFrom} format='DD-MM-YYYY' />
        <span className='grey-txt'>To</span>
        <DatePicker value={to} onChange={setTo} format='DD-MM-YYYY' />
        {kind === 'vouchers' && (
          <>
            <Select
              allowClear
              placeholder='Any type'
              value={type}
              onChange={setType}
              style={{ width: 110 }}
              options={VOUCHER_TYPES.map((t) => ({ value: t, label: t }))}
            />
            <Checkbox checked={narration} onChange={(e) => setNarration(e.target.checked)}
              title='The narration is read in full for every voucher - a search with this ticked takes a few seconds'>
              Search narrations too
            </Checkbox>
          </>
        )}
        <button type='button' className='btn-custom' onClick={() => run()} disabled={loading}>Show</button>
      </div>
      <Table
        rowKey={cfg.rowKey}
        size='small'
        bordered
        tableLayout='fixed'
        loading={loading}
        dataSource={result?.rows || []}
        columns={cfg.columns.map((c) => ({ ...c, key: c.dataIndex }))}
        onRow={(r) => ({ onClick: () => onOpen(cfg.open(r)), style: { cursor: 'pointer' } })}
        pagination={{
          current: page.current,
          pageSize: page.pageSize,
          total: result?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          showTotal: (t) => `${t.toLocaleString('en-US')} found`,
          onChange: (current, pageSize) => run({ current: pageSize !== page.pageSize ? 1 : current, pageSize }),
        }}
        locale={{ emptyText: loading ? ' ' : 'Nothing in this book matches.' }}
      />
    </div>
  );
};

export default SearchList;
