import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Select, DatePicker, Table, Spin } from 'antd';
import moment from 'moment';
import ReactToPrint from 'react-to-print';
import PrintArea from './PrintArea';
import openNotification from 'Components/Shared/Notification';
import { reportCompanyTitle, reportAddress, companyLogo, reportLetterheadId } from 'functions/companyBranding';
import { buildLedgerWorkbook, archiveFileName } from 'functions/archiveExcel';
import { archiveGet, showDate, money, drCr, DAY } from './shared';
import { Go } from './RecordViews';

// ONE ACCOUNT'S LEDGER in an old book: its opening (the balance the book was
// opened with plus everything before From - as Climax's own trial balance
// works it out, functions/archive/accounts), every line with its running
// balance, and the closing. A voucher number opens the voucher.

const Ledger = ({ book, bookLabel, summary, account, onAccount, onOpen, companyId }) => {
  const [options, setOptions] = useState(account ? [{ value: account.id, label: account.name }] : []);
  const [searching, setSearching] = useState(false);
  const [from, setFrom] = useState(summary?.firstDate ? moment(summary.firstDate, DAY) : null);
  const [to, setTo] = useState(summary?.lastDate ? moment(summary.lastDate, DAY) : null);
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const printRef = useRef(null);
  const printTrigger = useRef(null);
  const searchTimer = useRef(null);

  // The book's span arrives after the screen opens.
  useEffect(() => {
    if (summary?.firstDate && !from) setFrom(moment(summary.firstDate, DAY));
    if (summary?.lastDate && !to) setTo(moment(summary.lastDate, DAY));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  const search = (q) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const list = await archiveGet(book, 'accounts', { q });
        setOptions(list.map((a) => ({
          value: a.id,
          label: `${a.code ? `${a.code} - ` : ''}${a.name}${a.parent ? `  (${a.parent})` : ''}`,
          name: a.name,
        })));
      } catch (e) {
        openNotification('Error', e.message, 'red');
      } finally {
        setSearching(false);
      }
    }, 250);
  };

  const run = useCallback(async (acct = account) => {
    if (!acct?.id) return;
    setLoading(true);
    try {
      const res = await archiveGet(book, 'ledger', {
        account: acct.id,
        from: from ? from.format(DAY) : undefined,
        to: to ? to.format(DAY) : undefined,
      });
      setLedger(res);
    } catch (e) {
      openNotification('Error', e.message, 'red');
      setLedger(null);
    } finally {
      setLoading(false);
    }
  }, [book, account, from, to]);

  // Opened from a job's customer or a voucher line: show it straight away.
  useEffect(() => {
    if (account?.id) {
      setOptions((o) => (o.some((x) => x.value === account.id) ? o : [{ value: account.id, label: account.name }, ...o]));
      run(account);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  const logoSrc = companyLogo(reportLetterheadId(companyId), { print: true });

  const exportExcel = async () => {
    if (!ledger) return;
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = buildLedgerWorkbook(ExcelJS, {
        company: reportCompanyTitle(companyId),
        address: reportAddress(companyId),
        bookLabel,
        ledger,
      });
      const buffer = await wb.xlsx.writeBuffer();
      const url = window.URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = archiveFileName('Ledger', book, ledger.account.name);
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      openNotification('Error', 'Could not export the ledger.', 'red');
    }
  };

  const rows = ledger ? [
    { key: 'opening', opening: true, narration: 'Opening balance', balance: ledger.opening },
    ...ledger.rows.map((r, i) => ({ ...r, key: `${r.tranNo}-${i}` })),
  ] : [];

  const columns = [
    { title: 'Date', dataIndex: 'date', width: 105, render: showDate },
    { title: 'Voucher', dataIndex: 'voucherNo', width: 115,
      render: (v, r) => (r.opening ? '' : <Go onClick={() => onOpen({ kind: 'voucher', id: r.tranNo, label: v })}>{v || r.tranNo}</Go>) },
    { title: 'Type', dataIndex: 'type', width: 55 },
    { title: 'Cheque', dataIndex: 'chequeNo', width: 95, ellipsis: true },
    { title: 'Narration', dataIndex: 'narration', ellipsis: { showTitle: false },
      render: (v, r) => (r.opening ? <i>{v}</i> : <span title={v}>{v}</span>) },
    { title: 'Job', dataIndex: 'jobNo', width: 100 },
    { title: 'Debit', dataIndex: 'debit', width: 120, align: 'right', render: (v) => (v ? money(v) : '') },
    { title: 'Credit', dataIndex: 'credit', width: 120, align: 'right', render: (v) => (v ? money(v) : '') },
    { title: 'Balance', dataIndex: 'balance', width: 140, align: 'right', render: drCr },
  ];

  return (
    <div>
      <div className='archive-filters'>
        <Select
          showSearch
          filterOption={false}
          placeholder='Type an account name or code'
          style={{ width: 420 }}
          value={account?.id}
          options={options}
          onSearch={search}
          onFocus={() => { if (!options.length) search(''); }}
          notFoundContent={searching ? <Spin size='small' /> : 'No account matches'}
          onChange={(value, opt) => onAccount({ id: value, name: opt?.name || opt?.label })}
        />
        <span className='grey-txt'>From</span>
        <DatePicker value={from} onChange={setFrom} format='DD-MM-YYYY' />
        <span className='grey-txt'>To</span>
        <DatePicker value={to} onChange={setTo} format='DD-MM-YYYY' />
        <button type='button' className='btn-custom' onClick={() => run()} disabled={loading || !account?.id}>Show</button>
        <button type='button' className='btn-custom' onClick={exportExcel} disabled={!ledger}>Excel</button>
        <button type='button' className='btn-custom' onClick={() => printTrigger.current?.click()} disabled={!ledger}>Print</button>
      </div>

      {ledger && (
        <div className='archive-summary'>
          <div className='fig'><span>Account</span><b>{ledger.account.code ? `${ledger.account.code} - ` : ''}{ledger.account.name}</b></div>
          <div className='fig'><span>Opening</span><b>{drCr(ledger.opening)}</b></div>
          <div className='fig'><span>Debit</span><b>{money(ledger.totals.debit)}</b></div>
          <div className='fig'><span>Credit</span><b>{money(ledger.totals.credit)}</b></div>
          <div className='fig accent'><span>Closing</span><b>{drCr(ledger.closing)}</b></div>
        </div>
      )}

      <Table
        size='small'
        bordered
        tableLayout='fixed'
        loading={loading}
        dataSource={rows}
        columns={columns}
        rowKey='key'
        rowClassName={(r) => (r.opening ? 'archive-opening' : '')}
        pagination={{ defaultPageSize: 100, showSizeChanger: true, pageSizeOptions: [100, 500, 2000] }}
        locale={{ emptyText: account?.id ? 'No entries in this period.' : 'Pick an account, then Show.' }}
      />

      <ReactToPrint
        content={() => printRef.current}
        trigger={() => <button type='button' ref={printTrigger} style={{ display: 'none' }} aria-hidden='true' />}
      />
      <PrintArea>
        <div ref={printRef} className='archive-print'>
          <style>{'@media print { @page archiveLedger { size: A4 landscape; margin: 0; } .archive-print { page: archiveLedger; } }'}</style>
          {ledger && (
            <>
              <div className='letterhead'>
                <div className='logo'>{logoSrc && <img src={logoSrc} alt='' />}</div>
                <div className='names'>
                  <div className='co'>{reportCompanyTitle(companyId)}</div>
                  <div>{reportAddress(companyId)}</div>
                  <div className='title'>Ledger</div>
                </div>
                <div className='logo' />
              </div>
              <div className='period'>
                <b>{ledger.account.code ? `${ledger.account.code} - ` : ''}{ledger.account.name}</b>
                {'  '}From {ledger.from ? showDate(ledger.from) : 'the start of the book'} To {ledger.to ? showDate(ledger.to) : 'its end'}
                <span className='book'>Archive: {bookLabel}</span>
              </div>
              <table>
                <thead>
                  <tr><th style={{ width: '9%' }}>Date</th><th style={{ width: '10%' }}>Voucher</th><th style={{ width: '5%' }}>Type</th>
                    <th style={{ width: '8%' }}>Cheque</th><th>Narration</th><th style={{ width: '8%' }}>Job</th>
                    <th style={{ width: '10%' }}>Debit</th><th style={{ width: '10%' }}>Credit</th><th style={{ width: '12%' }}>Balance</th></tr>
                </thead>
                <tbody>
                  <tr><td /><td /><td /><td /><td><i>Opening balance</i></td><td /><td /><td /><td className='num'>{drCr(ledger.opening)}</td></tr>
                  {ledger.rows.map((r, i) => (
                    <tr key={`${r.tranNo}-${i}`}>
                      <td>{showDate(r.date)}</td><td>{r.voucherNo}</td><td>{r.type}</td><td>{r.chequeNo}</td>
                      <td>{r.narration}</td><td>{r.jobNo}</td>
                      <td className='num'>{r.debit ? money(r.debit) : ''}</td>
                      <td className='num'>{r.credit ? money(r.credit) : ''}</td>
                      <td className='num'>{drCr(r.balance)}</td>
                    </tr>
                  ))}
                  <tr className='total'>
                    <td colSpan={6} className='num'>Total</td>
                    <td className='num'>{money(ledger.totals.debit)}</td>
                    <td className='num'>{money(ledger.totals.credit)}</td>
                    <td className='num'>{drCr(ledger.closing)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      </PrintArea>
    </div>
  );
};

export default Ledger;
