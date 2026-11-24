import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DatePicker, Table, Select, Checkbox } from 'antd';
import moment from 'moment';
import ReactToPrint from 'react-to-print';
import PrintArea from './PrintArea';
import openNotification from 'Components/Shared/Notification';
import { reportCompanyTitle, reportAddress, companyLogo, reportLetterheadId } from 'functions/companyBranding';
import { buildTrialBalanceWorkbook, archiveFileName } from 'functions/archiveExcel';
import { archiveGet, showDate, money, DAY } from './shared';

// AN OLD BOOK'S TRIAL BALANCE, worked out as Climax's own TrialBalance
// procedure works it: the balance each account was opened with, plus what was
// posted before From, then the period's debits and credits. Groups add up
// their accounts (functions/archive/accounts rollUp).
//
// THE OLD BOOKS DO NOT BALANCE, and this does not pretend they do: the 2016
// book was opened with ₨95.2M of debits against ₨16.0M of credits, and its
// vouchers are ₨6.5M out between them. The difference is shown under the
// total, as it stands in Climax.

const dr = (v) => (v > 0.005 ? money(v) : '');
const cr = (v) => (v < -0.005 ? money(-v) : '');
const isZero = (r) => [r.opening, r.debit, r.credit, r.closing].every((v) => Math.abs(Number(v) || 0) < 0.005);

const TrialBalance = ({ book, bookLabel, summary, onLedger, companyId }) => {
  const years = summary?.years || [];
  const lastYear = years[years.length - 1];
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [tb, setTb] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hideZero, setHideZero] = useState(true);
  const [depth, setDepth] = useState(0); // 0 = every level
  const printRef = useRef(null);
  const printTrigger = useRef(null);

  // Opens on the book's last Climax year.
  useEffect(() => {
    if (!from && lastYear) {
      setFrom(moment(lastYear.from, DAY));
      setTo(moment(lastYear.to, DAY));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastYear?.code]);

  const pickYear = (code) => {
    if (code === 'all') {
      setFrom(moment(summary.firstDate, DAY));
      setTo(moment(summary.lastDate, DAY));
      return;
    }
    const y = years.find((x) => x.code === code);
    if (y) { setFrom(moment(y.from, DAY)); setTo(moment(y.to, DAY)); }
  };

  const run = async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      setTb(await archiveGet(book, 'trialBalance', { from: from.format(DAY), to: to.format(DAY) }));
    } catch (e) {
      openNotification('Error', e.message, 'red');
      setTb(null);
    } finally {
      setLoading(false);
    }
  };

  const maxLevel = useMemo(() => (tb ? Math.max(...tb.rows.map((r) => r.level)) : 0), [tb]);
  const rows = useMemo(() => (tb ? tb.rows.filter((r) => (!hideZero || !isZero(r)) && (!depth || r.level <= depth)) : []), [tb, hideZero, depth]);
  const t = tb?.totals || { opening: 0, debit: 0, credit: 0 };
  const closingTotal = (t.opening || 0) + (t.debit || 0) - (t.credit || 0);
  const outOfBalance = Math.abs(closingTotal) >= 0.01;

  const logoSrc = companyLogo(reportLetterheadId(companyId), { print: true });

  const exportExcel = async () => {
    if (!tb) return;
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = buildTrialBalanceWorkbook(ExcelJS, {
        company: reportCompanyTitle(companyId), address: reportAddress(companyId), bookLabel, tb, rows,
      });
      const buffer = await wb.xlsx.writeBuffer();
      const url = window.URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = archiveFileName('Trial Balance', book, `${tb.from} to ${tb.to}`);
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      openNotification('Error', 'Could not export the trial balance.', 'red');
    }
  };

  const columns = [
    { title: 'Code', dataIndex: 'code', width: 95 },
    { title: 'Account', dataIndex: 'name',
      render: (v, r) => (
        <span style={{ paddingLeft: (r.level - 1) * 16, fontWeight: r.isGroup ? 700 : 400 }}>
          {r.isGroup ? v : <button type='button' className='archive-link' onClick={() => onLedger({ id: r.id, name: v })}>{v}</button>}
        </span>
      ) },
    { title: 'Opening Dr', dataIndex: 'opening', width: 125, align: 'right', render: dr },
    { title: 'Opening Cr', dataIndex: 'opening', key: 'openingCr', width: 125, align: 'right', render: cr },
    { title: 'Debit', dataIndex: 'debit', width: 125, align: 'right', render: (v) => (v ? money(v) : '') },
    { title: 'Credit', dataIndex: 'credit', width: 125, align: 'right', render: (v) => (v ? money(v) : '') },
    { title: 'Closing Dr', dataIndex: 'closing', width: 125, align: 'right', render: dr },
    { title: 'Closing Cr', dataIndex: 'closing', key: 'closingCr', width: 125, align: 'right', render: cr },
  ];

  return (
    <div>
      <div className='archive-filters'>
        <Select
          placeholder='Climax year'
          style={{ width: 200 }}
          onChange={pickYear}
          options={[
            ...years.map((y) => ({ value: y.code, label: `${y.code}: ${showDate(y.from)} - ${showDate(y.to)}` })),
            ...(summary?.firstDate ? [{ value: 'all', label: 'The whole book' }] : []),
          ]}
        />
        <span className='grey-txt'>From</span>
        <DatePicker value={from} onChange={setFrom} format='DD-MM-YYYY' allowClear={false} />
        <span className='grey-txt'>To</span>
        <DatePicker value={to} onChange={setTo} format='DD-MM-YYYY' allowClear={false} />
        <button type='button' className='btn-custom' onClick={run} disabled={loading || !from || !to}>
          {loading ? 'Building…' : 'Show'}
        </button>
        <Checkbox checked={hideZero} onChange={(e) => setHideZero(e.target.checked)}>Hide zero rows</Checkbox>
        <Select value={depth} onChange={setDepth} style={{ width: 120 }}
          options={[{ value: 0, label: 'All levels' }, ...Array.from({ length: maxLevel }, (_, i) => ({ value: i + 1, label: `Level ${i + 1}` }))]} />
        <button type='button' className='btn-custom' onClick={exportExcel} disabled={!tb}>Excel</button>
        <button type='button' className='btn-custom' onClick={() => printTrigger.current?.click()} disabled={!tb}>Print</button>
      </div>

      {tb && outOfBalance && (
        <div className='archive-note'>
          This book does not balance in Climax: every account together comes to {money(Math.abs(closingTotal))}{' '}
          {closingTotal > 0 ? 'Dr' : 'Cr'}. Shown as it stands - the old book's openings and vouchers are not level.
        </div>
      )}

      <Table
        size='small'
        bordered
        tableLayout='fixed'
        loading={loading}
        dataSource={rows}
        columns={columns}
        rowKey='id'
        rowClassName={(r) => (r.isGroup ? 'archive-group' : '')}
        pagination={{ defaultPageSize: 200, showSizeChanger: true, pageSizeOptions: [100, 200, 500, 2000] }}
        locale={{ emptyText: 'Pick a period, then Show.' }}
        summary={() => tb && (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={2} align='right'><b>Total (every account)</b></Table.Summary.Cell>
            <Table.Summary.Cell index={2} align='right'><b>{dr(t.opening)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={3} align='right'><b>{cr(t.opening)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={4} align='right'><b>{money(t.debit)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={5} align='right'><b>{money(t.credit)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={6} align='right'><b>{dr(closingTotal)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={7} align='right'><b>{cr(closingTotal)}</b></Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />

      <ReactToPrint
        content={() => printRef.current}
        trigger={() => <button type='button' ref={printTrigger} style={{ display: 'none' }} aria-hidden='true' />}
      />
      <PrintArea>
        <div ref={printRef} className='archive-print'>
          <style>{'@media print { @page archiveTb { size: A4 landscape; margin: 0; } .archive-print { page: archiveTb; } }'}</style>
          {tb && (
            <>
              <div className='letterhead'>
                <div className='logo'>{logoSrc && <img src={logoSrc} alt='' />}</div>
                <div className='names'>
                  <div className='co'>{reportCompanyTitle(companyId)}</div>
                  <div>{reportAddress(companyId)}</div>
                  <div className='title'>Trial Balance</div>
                </div>
                <div className='logo' />
              </div>
              <div className='period'>
                From {showDate(tb.from)} To {showDate(tb.to)}
                <span className='book'>Archive: {bookLabel}</span>
              </div>
              <table>
                <thead>
                  <tr><th style={{ width: '8%' }}>Code</th><th>Account</th>
                    <th style={{ width: '10%' }}>Opening Dr</th><th style={{ width: '10%' }}>Opening Cr</th>
                    <th style={{ width: '10%' }}>Debit</th><th style={{ width: '10%' }}>Credit</th>
                    <th style={{ width: '10%' }}>Closing Dr</th><th style={{ width: '10%' }}>Closing Cr</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.isGroup ? 'group' : ''}>
                      <td>{r.code}</td>
                      <td style={{ paddingLeft: 4 + (r.level - 1) * 10 }}>{r.name}</td>
                      <td className='num'>{dr(r.opening)}</td><td className='num'>{cr(r.opening)}</td>
                      <td className='num'>{r.debit ? money(r.debit) : ''}</td><td className='num'>{r.credit ? money(r.credit) : ''}</td>
                      <td className='num'>{dr(r.closing)}</td><td className='num'>{cr(r.closing)}</td>
                    </tr>
                  ))}
                  <tr className='total'>
                    <td colSpan={2} className='num'>Total (every account)</td>
                    <td className='num'>{dr(t.opening)}</td><td className='num'>{cr(t.opening)}</td>
                    <td className='num'>{money(t.debit)}</td><td className='num'>{money(t.credit)}</td>
                    <td className='num'>{dr(closingTotal)}</td><td className='num'>{cr(closingTotal)}</td>
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

export default TrialBalance;
