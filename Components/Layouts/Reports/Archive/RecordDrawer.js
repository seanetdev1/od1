import React, { useEffect, useRef, useState } from 'react';
import { Drawer, Spin, Tag } from 'antd';
import { useSelector } from 'react-redux';
import ReactToPrint from 'react-to-print';
import PrintArea from './PrintArea';
import InvoicePrint from 'Components/Shared/InvoicePrint';
import { calculateTotal } from 'Components/Shared/invoicePrintDefaults';
import VoucherPrint from 'Components/Layouts/AccountsComp/Voucher/Print';
import { defaultBankAccount } from 'functions/companyBranding';
import { hasNote } from 'functions/invoiceNote';
import { archiveInvoicePrint, archiveVoucherPrint } from 'functions/archivePrint';
import { archiveGet } from './shared';
import { JobView, DocumentView, VoucherView } from './RecordViews';

// THE OPEN RECORD - a job, invoice, bill or voucher - in a drawer over the
// search. Following a link (a job's invoice, an invoice's voucher) opens the
// next record on top; Back returns to the one before, already loaded.
//
// PRINTS ARE ODYSSEY'S OWN (the user's decision, 2026-11-11): an invoice or
// bill on the customs invoice print, a voucher on the voucher print, both
// under the company selected in the header - see functions/archivePrint.

const PATHS = { job: 'jobs', invoice: 'invoices', bill: 'bills', voucher: 'vouchers' };
const NOUNS = { job: 'Job', invoice: 'Invoice', bill: 'Bill', voucher: 'Voucher' };

const RecordDrawer = ({ book, bookLabel, stack, onOpen, onBack, onClose, onLedger }) => {
  const top = stack[stack.length - 1] || null;
  const key = top ? `${top.kind}:${top.id}` : '';
  // Loaded records, by kind and id, so Back is instant. Dropped with the book.
  const [loaded, setLoaded] = useState({});
  const [error, setError] = useState('');
  const printRef = useRef(null);
  const printTrigger = useRef(null);

  const companyId = useSelector((s) => s.company.value);
  const companies = useSelector((s) => s.company.companies);
  const company = (Array.isArray(companies) ? companies : []).find((c) => String(c.id) === String(companyId)) || null;

  useEffect(() => { setLoaded({}); }, [book]);

  useEffect(() => {
    if (!top || loaded[key]) return undefined;
    let alive = true;
    setError('');
    archiveGet(book, `${PATHS[top.kind]}/${encodeURIComponent(top.id)}`)
      .then((r) => { if (alive) setLoaded((m) => ({ ...m, [key]: r })); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, book]);

  const record = top ? loaded[key] : null;
  const isDoc = top?.kind === 'invoice' || top?.kind === 'bill';
  const printable = record && (isDoc || top?.kind === 'voucher') && !record.isVoid;
  const docPrint = isDoc && record ? archiveInvoicePrint(record) : null;
  const voucherPrint = top?.kind === 'voucher' && record ? archiveVoucherPrint(record) : null;

  const title = top && (
    <div className='archive-drawer-title'>
      {stack.length > 1 && (
        <button type='button' className='archive-link me-2' onClick={onBack} title='Back to the record before'>
          ← {stack[stack.length - 2].label || NOUNS[stack[stack.length - 2].kind]}
        </button>
      )}
      <span>{NOUNS[top.kind]} {top.label}</span>
      <Tag className='ms-2'>{bookLabel}</Tag>
    </div>
  );

  return (
    <Drawer
      open={Boolean(top)}
      onClose={onClose}
      title={title}
      width='min(1150px, 96vw)'
      destroyOnClose={false}
      extra={printable ? (
        <button type='button' className='btn-custom' onClick={() => printTrigger.current?.click()}
          title={`Print on this install's ${isDoc ? 'invoice' : 'voucher'} layout`}>
          Print
        </button>
      ) : (record?.isVoid ? <span className='grey-txt' title='A void document is not printed'>Void - not printable</span> : null)}
    >
      {error && <div className='archive-void'>{error}</div>}
      {!error && top && !record && <div className='text-center py-5'><Spin /></div>}
      {record && top.kind === 'job' && <JobView job={record} onOpen={onOpen} onLedger={onLedger} />}
      {record && isDoc && <DocumentView doc={record} onOpen={onOpen} />}
      {record && top.kind === 'voucher' && <VoucherView voucher={record} onOpen={onOpen} onLedger={onLedger} />}

      {/* The printed copy, laid out off screen; the Print button clicks the
          hidden trigger, as on the other report screens. */}
      <ReactToPrint
        content={() => printRef.current}
        trigger={() => <button type='button' ref={printTrigger} style={{ display: 'none' }} aria-hidden='true' />}
      />
      <PrintArea width='210mm'>
        <div ref={printRef}>
          {docPrint?.invoice && (
            <InvoicePrint
              logo={false}
              compLogo={companyId ? String(companyId) : null}
              company={company}
              records={docPrint.records}
              bankAccount={defaultBankAccount(company?.BankAccounts, docPrint.invoice)}
              invoice={docPrint.invoice}
              note={!hasNote(docPrint.invoice)}
              reference={false}
              calculateTotal={calculateTotal}
              systemGenerated={false}
            />
          )}
          {voucherPrint && <VoucherPrint compLogo={companyId} voucherData={voucherPrint} />}
        </div>
      </PrintArea>
    </Drawer>
  );
};

export default RecordDrawer;
