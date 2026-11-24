import React, { useEffect, useState } from 'react';
import { Select, Tabs, Spin } from 'antd';
import { Row, Col } from 'react-bootstrap';
import { useSelector } from 'react-redux';
import { usePageActions } from 'Components/Shared/PageActions';
import openNotification from 'Components/Shared/Notification';
import { lastBook, rememberBook } from 'functions/archive';
import { archiveBooks, archiveGet, showDate } from './shared';
import SearchList from './SearchList';
import RecordDrawer from './RecordDrawer';
import Ledger from './Ledger';
import TrialBalance from './TrialBalance';

// THE ARCHIVE - CargoLinkers' old Climax books, read where they sit.
//
// Pick a book, then search within it: its jobs, invoices, bills and vouchers,
// an account's ledger, and the trial balance. Nothing here changes anything;
// the books are attached read-only on the server (routes/archive).
//
// THE BOOK IS ALWAYS NAMED - on the picker, on every open record and every
// print - because job and voucher numbers repeat from one book to the next:
// JL-00001 is in two of them, and not the same job.

const Archive = () => {
  const companyId = useSelector((s) => s.company.value);
  const [books, setBooks] = useState(null);
  const [book, setBook] = useState(null);
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('jobs');
  const [stack, setStack] = useState([]);
  const [ledgerAccount, setLedgerAccount] = useState(null);

  useEffect(() => {
    archiveBooks()
      .then((r) => {
        const list = r?.books || [];
        setBooks(list);
        const remembered = lastBook();
        setBook((list.find((b) => b.key === remembered) || list[0])?.key || null);
      })
      .catch(() => setBooks([]));
  }, []);

  useEffect(() => {
    if (!book) return undefined;
    let alive = true;
    setSummary(null);
    setStack([]);
    setLedgerAccount(null);
    archiveGet(book, 'summary')
      .then((s) => { if (alive) setSummary(s); })
      .catch((e) => { if (alive) openNotification('Error', e.message, 'red'); });
    return () => { alive = false; };
  }, [book]);

  const bookLabel = (books || []).find((b) => b.key === book)?.label || book || '';

  usePageActions({ title: 'Archive', subtitle: bookLabel || undefined }, [bookLabel]);

  const pickBook = (key) => { setBook(key); rememberBook(key); };
  const open = (rec) => setStack((s) => [...s, rec]);
  const back = () => setStack((s) => s.slice(0, -1));
  const close = () => setStack([]);
  const showLedger = (account) => {
    setLedgerAccount({ ...account });
    setStack([]);
    setTab('ledger');
  };

  if (books === null) return <div className='text-center py-5'><Spin /></div>;
  if (!books.length) {
    return (
      <div className='client-styles'>
        <h4 className='fw-7'>Archive</h4>
        <p className='grey-txt'>This install has no archive books set up. They are added on the server - see the install's runbook.</p>
      </div>
    );
  }

  const panes = [
    { key: 'jobs', label: 'Jobs', children: <SearchList key={`jobs-${book}`} book={book} kind='jobs' onOpen={open} /> },
    { key: 'invoices', label: 'Invoices', children: <SearchList key={`inv-${book}`} book={book} kind='invoices' onOpen={open} /> },
    { key: 'bills', label: 'Bills', children: <SearchList key={`bills-${book}`} book={book} kind='bills' onOpen={open} /> },
    { key: 'vouchers', label: 'Vouchers', children: <SearchList key={`v-${book}`} book={book} kind='vouchers' onOpen={open} /> },
    { key: 'ledger', label: 'Ledger', children: (
      <Ledger key={`ledger-${book}`} book={book} bookLabel={bookLabel} summary={summary} companyId={companyId}
        account={ledgerAccount} onAccount={setLedgerAccount} onOpen={open} />
    ) },
    { key: 'trialBalance', label: 'Trial Balance', children: (
      <TrialBalance key={`tb-${book}`} book={book} bookLabel={bookLabel} summary={summary} companyId={companyId}
        onLedger={showLedger} />
    ) },
  ];

  return (
    <div className='client-styles climax-archive'>
      <Row className='align-items-center mb-2'>
        <Col md='auto'><h4 className='fw-7 mb-0'>Archive</h4></Col>
        <Col className='d-flex align-items-center flex-wrap' style={{ gap: '0.75rem' }}>
          <span className='grey-txt'>Book</span>
          <Select
            value={book}
            onChange={pickBook}
            style={{ minWidth: 260 }}
            options={books.map((b) => ({ value: b.key, label: `${b.label}  (${b.key})` }))}
          />
          {summary && (
            <span className='archive-book-span'>
              {showDate(summary.firstDate)} to {showDate(summary.lastDate)}
              {' · '}{summary.jobs.toLocaleString('en-US')} jobs
              {' · '}{summary.vouchers.toLocaleString('en-US')} vouchers
            </span>
          )}
        </Col>
      </Row>
      <div className='archive-readonly grey-txt'>
        Read-only. Figures are as Climax holds them - each book stands on its own, with the opening balances it was started with.
      </div>

      <Tabs activeKey={tab} onChange={setTab} items={panes} />

      <RecordDrawer
        book={book}
        bookLabel={bookLabel}
        stack={stack}
        onOpen={open}
        onBack={back}
        onClose={close}
        onLedger={showLedger}
      />

      <style jsx global>{`
        .climax-archive { max-width: 100%; overflow-x: hidden; }
        .climax-archive .ant-table { font-size: 12px; }
        .climax-archive .archive-book-span { font-size: 12px; color: #555; background: #f6f8fa; border: 1px solid #eee; border-radius: 12px; padding: 2px 10px; }
        .climax-archive .archive-readonly { font-size: 11px; margin-bottom: 4px; }
        .archive-filters { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 10px; }
        .archive-link { background: none; border: none; padding: 0; color: #1677ff; cursor: pointer; text-align: left; }
        .archive-link:hover { text-decoration: underline; }
        .archive-fields { margin-bottom: 14px; }
        .archive-fields .ant-descriptions-title { font-size: 13px; }
        .archive-fields .ant-descriptions-item-label { width: 140px; font-size: 12px; }
        .archive-fields .ant-descriptions-item-content { font-size: 12px; }
        .archive-section { margin-bottom: 14px; }
        .archive-section .ant-table { font-size: 12px; }
        .archive-section-title { font-weight: 700; font-size: 13px; margin: 4px 0 6px; }
        .archive-stamp { font-size: 11px; margin-top: 6px; white-space: pre; }
        .archive-void { background: #fff1f0; border: 1px solid #ffa39e; color: #a8071a; padding: 6px 10px; border-radius: 6px; margin-bottom: 10px; }
        .archive-note { background: #fffbe6; border: 1px solid #ffe58f; padding: 6px 10px; border-radius: 6px; margin-bottom: 10px; font-size: 12px; }
        .archive-links { display: flex; gap: 18px; margin: -4px 0 12px; font-size: 12px; }
        .archive-totals { display: flex; justify-content: flex-end; gap: 28px; padding: 8px 12px; border: 1px solid #eee; border-radius: 8px; background: #fcfcfc; }
        .archive-totals div, .archive-summary .fig { display: flex; flex-direction: column; font-variant-numeric: tabular-nums; }
        .archive-totals span, .archive-summary .fig span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #999; }
        .archive-totals b, .archive-summary .fig b { font-size: 15px; }
        .archive-totals .accent b, .archive-summary .fig.accent b { color: #1677ff; }
        .archive-summary { display: flex; gap: 26px; flex-wrap: wrap; padding: 10px 14px; margin-bottom: 10px; border: 1px solid #eee; border-radius: 8px; background: #fcfcfc; }
        .climax-archive tr.archive-opening td { background: #fafafa; }
        .climax-archive tr.archive-group td { background: #f7f7f7; }
        .archive-drawer-title { display: flex; align-items: center; }
        .archive-print { font-family: Arial, sans-serif; font-size: 10px; color: #000; width: 297mm; box-sizing: border-box; padding: 8mm 8mm 10mm; }
        .archive-print .letterhead { display: flex; align-items: center; margin-bottom: 4px; font-size: 11px; }
        .archive-print .letterhead .logo { width: 20%; }
        .archive-print .letterhead .logo img { max-height: 60px; max-width: 100%; }
        .archive-print .letterhead .names { width: 60%; text-align: center; }
        .archive-print .letterhead .co { font-size: 16px; font-weight: 700; text-decoration: underline; }
        .archive-print .letterhead .title { font-size: 13px; font-weight: 700; text-decoration: underline; margin-top: 3px; }
        .archive-print .period { margin: 4px 0 6px; font-size: 11px; display: flex; gap: 12px; }
        .archive-print .period .book { margin-left: auto; font-style: italic; }
        .archive-print table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .archive-print th { background: #c0c0c0; font-weight: 700; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .archive-print th, .archive-print td { border: 1px solid #000; padding: 2px 4px; overflow-wrap: break-word; }
        .archive-print td.num { text-align: right; }
        .archive-print tr.group td { font-weight: 700; }
        .archive-print tr.total td { font-weight: 700; }
        .archive-print thead { display: table-header-group; }
        .archive-print tr { page-break-inside: avoid; }
      `}</style>
    </div>
  );
};

export default Archive;
